import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomInt, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { hashToken } from '../common/utils/token-hash';
import { hashInviteToken } from '../common/utils/invitation';
import { AuditService } from '../audit/audit.service';
import { DevicesService } from '../devices/devices.service';

@Injectable()
export class AuthService {
  private otpStore: Map<string, { otp: string; expiresAt: Date }> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
    private readonly devices: DevicesService,
  ) {}

  private refreshTtlMs() {
    const days = Number(process.env.REFRESH_TOKEN_DAYS || 30);
    return Math.max(1, days) * 24 * 60 * 60 * 1000;
  }

  private mintRefreshToken() {
    return randomBytes(48).toString('base64url');
  }

  private async issueSessionTokens(user: any, clientType: 'web' | 'android', deviceId?: string | null) {
    const sessionId = randomUUID();
    const payload = {
      userId: user.id,
      companyId: user.companyId,
      roleId: user.roleId,
      roleName: user.role.name,
      branchId: user.branchId,
      isPlatformAdmin: user.isPlatformAdmin,
      clientType,
      deviceId: deviceId || null,
      sessionId,
    };

    const accessToken = this.jwtService.sign(payload);
    const tokenHash = hashToken(accessToken);
    const refreshRaw = this.mintRefreshToken();
    const refreshHash = hashToken(refreshRaw);
    const familyId = randomUUID();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs());

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
      this.prisma.sessionLog.create({
        data: {
          id: sessionId,
          userId: user.id,
          token: tokenHash,
          deviceId: deviceId || null,
          isActive: true,
        },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: user.id,
          companyId: user.companyId,
          deviceId: deviceId || null,
          sessionId,
          tokenHash: refreshHash,
          familyId,
          expiresAt,
        },
      }),
    ]);

    return { accessToken, refreshToken: refreshRaw, sessionId };
  }

  private normalizePhone(phone: string): string {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length > 10) return digits.slice(-10);
    return digits;
  }

  async validateUser(phone: string, password: string, companyCode?: string): Promise<any> {
    const raw = String(phone || '').trim();
    const isEmail = raw.includes('@');
    const normalizedPhone = isEmail ? '' : this.normalizePhone(raw);
    // MySQL: no Prisma `mode: 'insensitive'`; default collations are usually CI.
    const matches = await this.prisma.user.findMany({
      where: isEmail
        ? { email: raw, status: 'ACTIVE' }
        : { phone: normalizedPhone, status: 'ACTIVE' },
      include: {
        role: true,
        company: true,
        branch: true,
        department: true,
        team: true,
      },
    });

    if (matches.length === 0) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    let user = matches[0];
    if (matches.length > 1) {
      if (!companyCode) {
        throw new BadRequestException(
          'Multiple companies found for this phone. Provide companyCode to continue.',
        );
      }
      const matched = matches.find(
        (u) => u.company.code.toLowerCase() === companyCode.toLowerCase(),
      );
      if (!matched) {
        throw new UnauthorizedException('Invalid phone number or password');
      }
      user = matched;
    } else if (companyCode) {
      if (user.company.code.toLowerCase() !== companyCode.toLowerCase()) {
        throw new UnauthorizedException(
          'Company code does not match this account. Use ADEMO for the demo company, or leave blank if unsure.',
        );
      }
    }

    if (!user.company.isActive || user.company.status !== 'ACTIVE') {
      throw new UnauthorizedException('Company account is suspended or inactive');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    return user;
  }

  enforceClientRoleGate(user: any, clientType: 'web' | 'android' = 'web') {
    const roleName = user.role?.name || user.roleName;
    if (clientType === 'android') {
      if (roleName !== 'TELECALLER') {
        throw new UnauthorizedException(
          'Only telecaller accounts can sign in on the Android app',
        );
      }
    } else if (roleName === 'TELECALLER') {
      throw new UnauthorizedException(
        'Telecallers must use the Android app. Web portal access is not allowed.',
      );
    }
  }

  async login(loginDto: LoginDto, clientTypeHeader?: string) {
    const user = await this.validateUser(
      loginDto.phone,
      loginDto.password,
      loginDto.companyCode,
    );

    const clientType =
      loginDto.clientType ||
      (clientTypeHeader === 'android' ? 'android' : 'web');
    this.enforceClientRoleGate(user, clientType);

    let boundDeviceId: string | null = loginDto.deviceId || null;
    if (clientType === 'android') {
      const device = await this.devices.assertAndBindAndroidDevice(
        user.id,
        user.companyId,
        {
          deviceId: loginDto.deviceId || '',
          publicKey: loginDto.publicKey,
          model: loginDto.model,
          androidVersion: loginDto.androidVersion,
          appVersion: loginDto.appVersion,
          riskFlags: loginDto.riskFlags,
        },
        { forceReplace: !!loginDto.forceReplaceDevice },
      );
      boundDeviceId = device.deviceId;
    }

    const tokens = await this.issueSessionTokens(user, clientType, boundDeviceId);

    await this.audit.logAction({
      userId: user.id,
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      companyId: user.companyId,
      newValues: { clientType, deviceId: boundDeviceId },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      mustChangePassword: !!user.mustChangePassword,
      user: this.formatUser(user),
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash, mustChangePassword: false },
    });
    await this.audit.logAction({
      userId,
      action: 'CHANGE_PASSWORD',
      entity: 'User',
      entityId: userId,
      companyId: user.companyId,
    });
    return { success: true, mustChangePassword: false };
  }

  private formatUser(user: any) {
    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      employeeId: user.employeeId,
      isPlatformAdmin: user.isPlatformAdmin,
      mustChangePassword: !!user.mustChangePassword,
      role: {
        id: user.role.id,
        name: user.role.name,
        displayName: user.role.displayName,
        permissions: user.role.permissions,
      },
      roleName: user.role.name,
      company: {
        id: user.company.id,
        name: user.company.name,
        code: user.company.code,
        status: user.company.status,
      },
      companyId: user.companyId,
      branch: user.branch
        ? { id: user.branch.id, name: user.branch.name, code: user.branch.code }
        : null,
      department: user.department
        ? { id: user.department.id, name: user.department.name }
        : null,
      team: user.team ? { id: user.team.id, name: user.team.name } : null,
      dailyTarget: user.dailyTarget,
      shareLink: user.shareLink || null,
      profileImage: user.profileImage,
    };
  }

  async acceptInvitation(dto: AcceptInviteDto) {
    const tokenHash = hashInviteToken(dto.token);
    const invitation = await this.prisma.invitation.findFirst({
      where: { tokenHash, status: 'PENDING' },
      include: { user: { include: { company: true, role: true } } },
    });

    if (!invitation) {
      throw new BadRequestException('Invalid or already used invitation');
    }

    if (invitation.expiresAt < new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('Invitation has expired');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: invitation.userId },
        data: { password: passwordHash, status: 'ACTIVE', mustChangePassword: false },
      }),
      this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', usedAt: new Date() },
      }),
    ]);

    await this.audit.logAction({
      userId: invitation.userId,
      action: 'INVITATION_ACCEPTED',
      entity: 'Invitation',
      entityId: invitation.id,
      companyId: invitation.user.companyId,
    });

    return { message: 'Password set successfully. You can now log in.' };
  }

  generateOtp(phone: string): string {
    const otp = randomInt(100000, 1000000).toString();
    this.otpStore.set(phone, {
      otp,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    return otp;
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const stored = this.otpStore.get(verifyOtpDto.phone);

    if (!stored) {
      throw new BadRequestException('OTP not found. Please request a new one.');
    }

    if (new Date() > stored.expiresAt) {
      this.otpStore.delete(verifyOtpDto.phone);
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    if (stored.otp !== verifyOtpDto.otp) {
      throw new BadRequestException('Invalid OTP');
    }

    this.otpStore.delete(verifyOtpDto.phone);

    const matches = await this.prisma.user.findMany({
      where: { phone: verifyOtpDto.phone, status: 'ACTIVE' },
      include: { role: true, company: true },
    });

    if (matches.length === 0) {
      throw new UnauthorizedException('User not found');
    }

    if (matches.length > 1) {
      throw new BadRequestException(
        'Multiple companies found for this phone. Use password login with companyCode.',
      );
    }

    const user = matches[0];

    const payload = {
      userId: user.id,
      companyId: user.companyId,
      roleId: user.roleId,
      roleName: user.role.name,
      branchId: user.branchId,
    };

    const token = this.jwtService.sign(payload);

    await this.prisma.sessionLog.create({
      data: {
        userId: user.id,
        token: hashToken(token),
        isActive: true,
      },
    });

    return {
      accessToken: token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: { id: user.role.id, name: user.role.name, displayName: user.role.displayName },
        company: { id: user.company.id, name: user.company.name },
      },
    };
  }

  /** Legacy: rotate using current access JWT (kept for older clients). */
  async refreshToken(currentUser: any, rawToken?: string) {
    if (!rawToken) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const tokenHash = hashToken(rawToken);
    const session = await this.prisma.sessionLog.findFirst({
      where: {
        userId: currentUser.userId,
        token: tokenHash,
        isActive: true,
      },
    });

    if (!session) {
      throw new UnauthorizedException('Session is inactive or not found');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: currentUser.userId },
      include: { role: true, company: true, branch: true, department: true, team: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const tokens = await this.issueSessionTokens(
      user,
      currentUser.clientType || 'web',
      session.deviceId,
    );

    await this.prisma.sessionLog.update({
      where: { id: session.id },
      data: { isActive: false, logoutAt: new Date() },
    });

    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  /** Preferred: one-time refresh token rotation (works after access JWT expires). */
  async refreshWithRefreshToken(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!stored || stored.revokedAt) {
      if (stored?.familyId) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Refresh token is invalid or reused');
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { role: true, company: true, branch: true, department: true, team: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User is inactive or not found');
    }

    const clientType = stored.deviceId ? 'android' : 'web';
    if (clientType === 'android' && stored.deviceId) {
      await this.devices.assertActiveDevice(user.id, stored.deviceId);
    }

    const tokens = await this.issueSessionTokens(user, clientType, stored.deviceId);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), rotatedAt: new Date() },
    });
    // Link new refresh to same family for reuse detection
    await this.prisma.refreshToken.updateMany({
      where: {
        userId: user.id,
        tokenHash: hashToken(tokens.refreshToken),
      },
      data: { familyId: stored.familyId },
    });

    if (stored.sessionId) {
      await this.prisma.sessionLog.updateMany({
        where: { id: stored.sessionId, isActive: true },
        data: { isActive: false, logoutAt: new Date() },
      });
    }

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: this.formatUser(user),
    };
  }

  async logout(userId: string, rawToken?: string) {
    const now = new Date();
    if (rawToken) {
      const tokenHash = hashToken(rawToken);
      await this.prisma.sessionLog.updateMany({
        where: { userId, token: tokenHash, isActive: true },
        data: { isActive: false, logoutAt: now },
      });
      const { invalidateSessionAuthCache } = await import('./session-cache');
      invalidateSessionAuthCache(tokenHash);
    } else {
      await this.prisma.sessionLog.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false, logoutAt: now },
      });
      const { invalidateAllSessionAuthCache } = await import('./session-cache');
      invalidateAllSessionAuthCache();
    }
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });

    return { message: 'Logged out successfully' };
  }

  async revokeAllSessions(userId: string, companyId: string, adminId: string) {
    const { invalidateAllSessionAuthCache } = await import('./session-cache');
    invalidateAllSessionAuthCache();
    await this.devices.revokeUserSessions(userId);
    await this.audit.logAction({
      userId: adminId,
      action: 'SESSIONS_REVOKE_ALL',
      entity: 'User',
      entityId: userId,
      companyId,
    });
    return { message: 'All sessions revoked' };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: true,
        company: true,
        branch: true,
        department: true,
        team: true,
        reportingManager: {
          select: { id: true, name: true, phone: true, employeeId: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.formatUser(user);
  }
}
