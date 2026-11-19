import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { resolveJwtSecret } from '../common/utils/jwt-secret';
import { hashToken } from '../common/utils/token-hash';
import {
  CachedAuthUser,
  deviceTouchThrottle,
  sessionAuthCache,
} from './session-cache';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any): Promise<CachedAuthUser> {
    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    const tokenHash = rawToken ? hashToken(rawToken) : '';
    if (tokenHash) {
      const cached = sessionAuthCache.get(tokenHash);
      if (cached) {
        const clientType =
          payload.clientType || String(req.headers['x-client-type'] || '').toLowerCase() || cached.clientType;
        if (clientType === 'android') {
          const headerDevice = String(req.headers['x-device-id'] || '').trim();
          const claimDevice = payload.deviceId ? String(payload.deviceId) : '';
          const deviceId = headerDevice || claimDevice;
          // Re-validate device only when identity changes; otherwise throttle touch only
          if (!deviceId) {
            throw new ForbiddenException('Missing device identity');
          }
          if (cached.deviceId && cached.deviceId !== deviceId) {
            await this.assertAndroidDevice(req, payload, cached.userId);
          } else {
            await this.touchAndroidDeviceThrottled(cached.userId, deviceId);
          }
        }
        return { ...cached, clientType, deviceId: payload.deviceId || cached.deviceId };
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        status: true,
        isPlatformAdmin: true,
        mustChangePassword: true,
        companyId: true,
        roleId: true,
        branchId: true,
        teamId: true,
        deviceId: true,
        role: { select: { name: true, permissions: true } },
        company: { select: { id: true, status: true, isActive: true } },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User is inactive or not found');
    }

    if (user.status === 'BLOCKED') {
      throw new UnauthorizedException('User is blocked');
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User is inactive or not found');
    }

    if (!user.company.isActive || user.company.status === 'SUSPENDED' || user.company.status === 'INACTIVE') {
      throw new UnauthorizedException('Company account is suspended or inactive');
    }

    if (tokenHash) {
      const session = await this.prisma.sessionLog.findFirst({
        where: {
          userId: user.id,
          token: tokenHash,
          isActive: true,
        },
        select: { id: true },
      });
      if (!session) {
        throw new UnauthorizedException('Session is inactive or revoked');
      }
    }

    const clientType =
      payload.clientType || String(req.headers['x-client-type'] || '').toLowerCase() || 'web';
    let resolvedDeviceId: string | null = payload.deviceId || null;
    if (clientType === 'android') {
      const headerDevice = String(req.headers['x-device-id'] || '').trim();
      resolvedDeviceId = headerDevice || (payload.deviceId ? String(payload.deviceId) : null);
      await this.assertAndroidDevice(req, payload, user.id);
    }

    const authUser: CachedAuthUser = {
      id: user.id,
      userId: user.id,
      companyId: user.companyId,
      roleId: user.roleId,
      roleName: user.role.name,
      branchId: user.branchId,
      teamId: user.teamId,
      isPlatformAdmin: user.isPlatformAdmin,
      mustChangePassword: user.mustChangePassword,
      permissions: user.role.permissions,
      clientType: clientType || payload.clientType || 'web',
      deviceId: resolvedDeviceId,
      sessionId: payload.sessionId || null,
    };

    if (tokenHash) {
      sessionAuthCache.set(tokenHash, authUser);
    }

    return authUser;
  }

  private async assertAndroidDevice(req: Request, payload: any, userId: string) {
    const headerDevice = String(req.headers['x-device-id'] || '').trim();
    const claimDevice = payload.deviceId ? String(payload.deviceId) : '';
    const deviceId = headerDevice || claimDevice;
    if (!deviceId) {
      throw new ForbiddenException('Missing device identity');
    }
    const device = await this.prisma.userDevice.findFirst({
      where: { userId, deviceId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!device) {
      throw new ForbiddenException('Device is not authorized for this account');
    }
    await this.touchAndroidDeviceThrottled(userId, deviceId, device.id);
  }

  private async touchAndroidDeviceThrottled(
    userId: string,
    deviceId: string,
    knownDeviceRowId?: string,
  ) {
    if (deviceTouchThrottle.get(deviceId)) return;
    deviceTouchThrottle.set(deviceId, true);
    let id = knownDeviceRowId;
    if (!id) {
      const device = await this.prisma.userDevice.findFirst({
        where: { userId, deviceId, status: 'ACTIVE' },
        select: { id: true },
      });
      id = device?.id;
    }
    if (!id) return;
    void this.prisma.userDevice
      .update({
        where: { id },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => undefined);
  }
}
