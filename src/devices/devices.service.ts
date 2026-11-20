import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export type DeviceMeta = {
  deviceId: string;
  publicKey?: string;
  model?: string;
  androidVersion?: string;
  appVersion?: string;
  riskFlags?: string[];
  fcmToken?: string;
};

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Android one-device policy: bind on first login, deny other devices until admin reset
   * (or telecaller self-authorize via forceReplace after password check).
   */
  async assertAndBindAndroidDevice(
    userId: string,
    companyId: string,
    meta: DeviceMeta,
    opts?: { forceReplace?: boolean },
  ) {
    if (!meta.deviceId?.trim()) {
      throw new BadRequestException('deviceId is required for Android login');
    }

    let active = await this.prisma.userDevice.findFirst({
      where: { userId, status: 'ACTIVE' },
    });

    if (active && active.deviceId !== meta.deviceId) {
      if (opts?.forceReplace) {
        const previousId = active.deviceId;
        const allActive = await this.prisma.userDevice.findMany({
          where: { userId, companyId, status: 'ACTIVE' },
        });
        for (const d of allActive) {
          await this.revoke(d.id, companyId, userId);
        }
        await this.revokeUserSessions(userId);
        await this.audit.logAction({
          userId,
          action: 'DEVICE_SELF_REPLACE',
          entity: 'UserDevice',
          entityId: active.id,
          companyId,
          newValues: { previousDeviceId: previousId, newDeviceId: meta.deviceId },
        });
        active = null;
      } else {
        await this.audit.logAction({
          userId,
          action: 'LOGIN_DENIED_DEVICE',
          entity: 'UserDevice',
          entityId: active.id,
          companyId,
          newValues: { attemptedDeviceId: meta.deviceId, boundDeviceId: active.deviceId },
        });
        throw new ForbiddenException(
          'This account is already registered on another device. Please contact your administrator to authorize a new device.',
        );
      }
    }

    const now = new Date();
    if (active) {
      const updated = await this.prisma.userDevice.update({
        where: { id: active.id },
        data: {
          publicKey: meta.publicKey ?? active.publicKey,
          model: meta.model ?? active.model,
          androidVersion: meta.androidVersion ?? active.androidVersion,
          appVersion: meta.appVersion ?? active.appVersion,
          riskFlags: meta.riskFlags ?? (active.riskFlags as any),
          lastActiveAt: now,
          lastAuthAt: now,
        },
      });
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          deviceId: meta.deviceId,
          ...(meta.fcmToken ? { fcmToken: meta.fcmToken } : {}),
        },
      });
      return updated;
    }

    // Same deviceId may exist as REVOKED/BLOCKED — reactivate only if it belonged to this user
    const existingSame = await this.prisma.userDevice.findUnique({
      where: { deviceId: meta.deviceId },
    });
    if (existingSame && existingSame.userId !== userId) {
      throw new ForbiddenException(
        'This device is registered to another account. Contact your administrator.',
      );
    }

    let device;
    if (existingSame) {
      device = await this.prisma.userDevice.update({
        where: { id: existingSame.id },
        data: {
          status: 'ACTIVE',
          publicKey: meta.publicKey ?? existingSame.publicKey,
          model: meta.model ?? existingSame.model,
          androidVersion: meta.androidVersion ?? existingSame.androidVersion,
          appVersion: meta.appVersion ?? existingSame.appVersion,
          riskFlags: meta.riskFlags ?? (existingSame.riskFlags as any),
          registeredAt: now,
          lastActiveAt: now,
          lastAuthAt: now,
          revokedAt: null,
        },
      });
    } else {
      device = await this.prisma.userDevice.create({
        data: {
          userId,
          companyId,
          deviceId: meta.deviceId,
          publicKey: meta.publicKey,
          model: meta.model,
          androidVersion: meta.androidVersion,
          appVersion: meta.appVersion,
          riskFlags: meta.riskFlags ?? [],
          status: 'ACTIVE',
          lastActiveAt: now,
          lastAuthAt: now,
        },
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deviceId: meta.deviceId,
        ...(meta.fcmToken ? { fcmToken: meta.fcmToken } : {}),
      },
    });

    await this.audit.logAction({
      userId,
      action: 'DEVICE_REGISTER',
      entity: 'UserDevice',
      entityId: device.id,
      companyId,
      newValues: { deviceId: meta.deviceId, model: meta.model },
    });

    return device;
  }

  async touchActiveDevice(userId: string, deviceId: string) {
    if (!deviceId) return;
    await this.prisma.userDevice.updateMany({
      where: { userId, deviceId, status: 'ACTIVE' },
      data: { lastActiveAt: new Date() },
    });
  }

  async assertActiveDevice(userId: string, deviceId: string | undefined) {
    if (!deviceId) {
      throw new ForbiddenException('Missing X-Device-Id header');
    }
    const device = await this.prisma.userDevice.findFirst({
      where: { userId, deviceId, status: 'ACTIVE' },
    });
    if (!device) {
      throw new ForbiddenException('Device is not authorized for this account');
    }
    return device;
  }

  async registerOrUpdateSelf(
    userId: string,
    companyId: string,
    meta: DeviceMeta,
  ) {
    if (!meta.deviceId?.trim()) {
      throw new BadRequestException('deviceId is required for Android login');
    }

    // Cheap path: device already bound in this login window — touch activity only
    const active = await this.prisma.userDevice.findFirst({
      where: { userId, status: 'ACTIVE', deviceId: meta.deviceId },
    });
    if (active?.lastAuthAt && Date.now() - active.lastAuthAt.getTime() < 120_000) {
      return this.prisma.userDevice.update({
        where: { id: active.id },
        data: {
          lastActiveAt: new Date(),
          ...(meta.appVersion ? { appVersion: meta.appVersion } : {}),
        },
      });
    }

    return this.assertAndBindAndroidDevice(userId, companyId, meta);
  }

  async listForCompany(
    companyId: string,
    userId?: string,
    pagination: { page?: number; pageSize?: number } = {},
  ) {
    const { clampPage, clampPageSize } = await import('../common/utils/pagination');
    const page = clampPage(pagination.page);
    const pageSize = clampPageSize(pagination.pageSize);
    const where = {
      companyId,
      ...(userId ? { userId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.userDevice.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              employeeId: true,
              status: true,
            },
          },
        },
        orderBy: { lastActiveAt: 'desc' },
      }),
      this.prisma.userDevice.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getOne(id: string, companyId: string) {
    const device = await this.prisma.userDevice.findFirst({
      where: { id, companyId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            employeeId: true,
            status: true,
          },
        },
      },
    });
    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  async history(id: string, companyId: string) {
    const device = await this.getOne(id, companyId);
    const logs = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        OR: [
          { entity: 'UserDevice', entityId: id },
          {
            entity: 'UserDevice',
            userId: device.userId,
            action: {
              in: [
                'DEVICE_REGISTER',
                'DEVICE_REVOKE',
                'DEVICE_RESET',
                'DEVICE_BLOCK',
                'LOGIN_DENIED_DEVICE',
                'LOGIN_OK_DEVICE',
                'SCREENSHOT_ATTEMPT',
              ],
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { device, logs };
  }

  async block(id: string, companyId: string, adminId: string) {
    const device = await this.getOne(id, companyId);
    const updated = await this.prisma.userDevice.update({
      where: { id },
      data: { status: 'BLOCKED', revokedAt: new Date() },
    });
    await this.revokeUserSessions(device.userId);
    await this.audit.logAction({
      userId: adminId,
      action: 'DEVICE_BLOCK',
      entity: 'UserDevice',
      entityId: id,
      companyId,
      newValues: { deviceId: device.deviceId },
    });
    return updated;
  }

  async revoke(id: string, companyId: string, adminId: string) {
    const device = await this.getOne(id, companyId);
    const updated = await this.prisma.userDevice.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (device.status === 'ACTIVE') {
      await this.prisma.user.update({
        where: { id: device.userId },
        data: { deviceId: null },
      });
    }
    await this.revokeUserSessions(device.userId);
    await this.audit.logAction({
      userId: adminId,
      action: 'DEVICE_REVOKE',
      entity: 'UserDevice',
      entityId: id,
      companyId,
      newValues: { deviceId: device.deviceId },
    });
    return updated;
  }

  /** Reset = revoke ACTIVE so the next login can bind a replacement phone. */
  async reset(id: string, companyId: string, adminId: string) {
    return this.revoke(id, companyId, adminId).then(async (d) => {
      await this.audit.logAction({
        userId: adminId,
        action: 'DEVICE_RESET',
        entity: 'UserDevice',
        entityId: id,
        companyId,
        newValues: { deviceId: d.deviceId, note: 'Ready for replacement bind' },
      });
      return d;
    });
  }

  async authorizeReplacement(userId: string, companyId: string, adminId: string) {
    const active = await this.prisma.userDevice.findMany({
      where: { userId, companyId, status: 'ACTIVE' },
    });
    for (const d of active) {
      await this.revoke(d.id, companyId, adminId);
    }
    await this.audit.logAction({
      userId: adminId,
      action: 'DEVICE_AUTHORIZE_REPLACEMENT',
      entity: 'User',
      entityId: userId,
      companyId,
    });
    return { message: 'Previous device revoked. Telecaller can register a new device on next login.' };
  }

  async revokeUserSessions(userId: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.sessionLog.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false, logoutAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  async logScreenshotAttempt(userId: string, companyId: string, deviceId?: string) {
    await this.audit.logAction({
      userId,
      action: 'SCREENSHOT_ATTEMPT',
      entity: 'UserDevice',
      entityId: deviceId || undefined,
      companyId,
      newValues: { deviceId, at: new Date().toISOString() },
    });
    return { logged: true };
  }
}
