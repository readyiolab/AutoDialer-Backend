import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { resolveJwtSecret } from '../common/utils/jwt-secret';
import { hashToken } from '../common/utils/token-hash';

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

  async validate(req: Request, payload: any) {
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

    const rawToken = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      const session = await this.prisma.sessionLog.findFirst({
        where: {
          userId: user.id,
          token: tokenHash,
          isActive: true,
        },
      });
      if (!session) {
        throw new UnauthorizedException('Session is inactive or revoked');
      }
    }

    const clientType = payload.clientType || String(req.headers['x-client-type'] || '').toLowerCase();
    if (clientType === 'android') {
      const headerDevice = String(req.headers['x-device-id'] || '').trim();
      const claimDevice = payload.deviceId ? String(payload.deviceId) : '';
      const deviceId = headerDevice || claimDevice;
      if (!deviceId) {
        throw new ForbiddenException('Missing device identity');
      }
      const device = await this.prisma.userDevice.findFirst({
        where: { userId: user.id, deviceId, status: 'ACTIVE' },
      });
      if (!device) {
        throw new ForbiddenException('Device is not authorized for this account');
      }
      // best-effort last-active touch (non-blocking)
      void this.prisma.userDevice.update({
        where: { id: device.id },
        data: { lastActiveAt: new Date() },
      }).catch(() => undefined);
    }

    return {
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
      deviceId: payload.deviceId || null,
      sessionId: payload.sessionId || null,
    };
  }
}
