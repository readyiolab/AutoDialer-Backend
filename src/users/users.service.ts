import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  clampListLimit,
  clampPage,
  clampPageSize,
  resolveSortBy,
} from '../common/utils/pagination';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import {
  buildInviteUrl,
  generateInviteToken,
  hashInviteToken,
  invitationExpiry,
} from '../common/utils/invitation';

const USER_SORT_FIELDS = [
  'createdAt',
  'name',
  'employeeId',
  'phone',
  'status',
  'lastLoginAt',
] as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  private async nextEmployeeId(companyId: string): Promise<string> {
    const count = await this.prisma.user.count({ where: { companyId } });
    return `EMP-${String(count + 1).padStart(4, '0')}`;
  }

  async findAll(
    companyId: string,
    pagination: PaginationDto,
    filters: {
      status?: string;
      roleId?: string;
      branchId?: string;
      departmentId?: string;
      search?: string;
    },
  ) {
    const page = clampPage(pagination.page);
    const pageSize = clampPageSize(pagination.pageSize);
    const sortBy = resolveSortBy(pagination.sortBy, USER_SORT_FIELDS, 'createdAt');
    const sortOrder = pagination.sortOrder === 'asc' ? 'asc' : 'desc';
    const skip = (page - 1) * pageSize;

    const where: any = { companyId };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.roleId) {
      where.roleId = filters.roleId;
    }
    if (filters.branchId) {
      where.branchId = filters.branchId;
    }
    if (filters.departmentId) {
      where.departmentId = filters.departmentId;
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { employeeId: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        select: {
          id: true,
          employeeId: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          dailyTarget: true,
          shareLink: true,
          profileImage: true,
          lastLoginAt: true,
          createdAt: true,
          role: { select: { id: true, name: true, displayName: true } },
          branch: { select: { id: true, name: true, code: true } },
          department: { select: { id: true, name: true } },
          reportingManager: { select: { id: true, name: true, employeeId: true } },
          team: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static readonly SORT_FIELDS = USER_SORT_FIELDS;

  async findOne(id: string, companyId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId },
      include: {
        role: { select: { id: true, name: true, displayName: true, permissions: true } },
        branch: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true } },
        reportingManager: { select: { id: true, name: true, employeeId: true, phone: true } },
        subordinates: {
          select: { id: true, name: true, employeeId: true, phone: true },
          where: { status: 'ACTIVE' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { password, ...result } = user;
    return result;
  }

  async create(createUserDto: CreateUserDto, companyId: string, performedById?: string) {
    const employeeId =
      createUserDto.employeeId?.trim() || (await this.nextEmployeeId(companyId));

    const phoneTaken = await this.prisma.user.findFirst({
      where: { phone: createUserDto.phone },
      select: { id: true },
    });
    if (phoneTaken) {
      throw new ConflictException('This mobile number is already registered');
    }

    const employeeTaken = await this.prisma.user.findFirst({
      where: { employeeId, companyId },
      select: { id: true },
    });
    if (employeeTaken) {
      throw new ConflictException('A user with this employee ID already exists');
    }

    const sendInvitation = createUserDto.sendInvitation !== false && !createUserDto.password;
    const rawPassword = createUserDto.password || randomBytes(32).toString('hex');
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const { password: _p, sendInvitation: _s, ...rest } = createUserDto as any;

    const user = await this.prisma.user.create({
      data: {
        ...rest,
        employeeId,
        password: hashedPassword,
        companyId,
        dailyTarget: createUserDto.dailyTarget || 100,
      },
      include: {
        role: { select: { id: true, name: true, displayName: true } },
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        team: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
    });

    let invitationSent = false;
    if (sendInvitation && user.email) {
      const token = generateInviteToken();
      const invite = await this.prisma.invitation.create({
        data: {
          userId: user.id,
          tokenHash: hashInviteToken(token),
          email: user.email,
          expiresAt: invitationExpiry(48),
          status: 'PENDING',
        },
      });
      const mailResult = await this.mail.sendInvitationEmail({
        to: user.email,
        name: user.name,
        companyName: user.company.name,
        inviteUrl: buildInviteUrl(token),
      });
      invitationSent = mailResult.sent;
      await this.prisma.invitation.update({
        where: { id: invite.id },
        data: mailResult.sent
          ? { emailSentAt: new Date() }
          : { emailFailed: true, emailError: mailResult.error },
      });
    }

    if (performedById) {
      await this.audit.logAction({
        userId: performedById,
        action: 'USER_CREATE',
        entity: 'User',
        entityId: user.id,
        companyId,
        newValues: { name: user.name, employeeId: user.employeeId, roleId: user.roleId },
      });
    }

    const { password, company, ...result } = user as any;
    return { ...result, invitationSent };
  }

  async resendInvitation(userId: string, companyId: string, performedById: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      include: { company: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.email) throw new BadRequestException('User has no email');

    await this.prisma.invitation.updateMany({
      where: { userId, status: 'PENDING' },
      data: { status: 'REVOKED' },
    });

    const token = generateInviteToken();
    const invite = await this.prisma.invitation.create({
      data: {
        userId,
        tokenHash: hashInviteToken(token),
        email: user.email,
        expiresAt: invitationExpiry(48),
        status: 'PENDING',
      },
    });
    const mailResult = await this.mail.sendInvitationEmail({
      to: user.email,
      name: user.name,
      companyName: user.company.name,
      inviteUrl: buildInviteUrl(token),
    });
    await this.prisma.invitation.update({
      where: { id: invite.id },
      data: mailResult.sent
        ? { emailSentAt: new Date() }
        : { emailFailed: true, emailError: mailResult.error },
    });
    await this.audit.logAction({
      userId: performedById,
      action: 'INVITATION_RESEND',
      entity: 'User',
      entityId: userId,
      companyId,
    });
    return { invitationSent: mailResult.sent };
  }

  async setStatus(
    id: string,
    status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED',
    companyId: string,
    performedById: string,
  ) {
    const existing = await this.prisma.user.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('User not found');
    const user = await this.prisma.user.update({
      where: { id },
      data: { status },
      select: { id: true, name: true, status: true, employeeId: true },
    });
    if (status === 'BLOCKED' || status === 'INACTIVE') {
      const now = new Date();
      await this.prisma.sessionLog.updateMany({
        where: { userId: id, isActive: true },
        data: { isActive: false, logoutAt: now },
      });
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.prisma.userDevice.updateMany({
        where: { userId: id, status: 'ACTIVE' },
        data: { status: 'BLOCKED', revokedAt: now },
      });
    }
    await this.audit.logAction({
      userId: performedById,
      action: 'USER_STATUS',
      entity: 'User',
      entityId: id,
      companyId,
      newValues: { status },
    });
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto, companyId: string) {
    const existing = await this.prisma.user.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    const data: any = { ...updateUserDto };

    if (updateUserDto.password) {
      data.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    if (updateUserDto.phone && updateUserDto.phone !== existing.phone) {
      const phoneExists = await this.prisma.user.findFirst({
        where: { phone: updateUserDto.phone, id: { not: id } },
      });
      if (phoneExists) {
        throw new ConflictException('This mobile number is already registered');
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
      include: {
        role: { select: { id: true, name: true, displayName: true } },
        branch: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    const { password, ...result } = user;
    return result;
  }

  async remove(id: string, companyId: string) {
    const existing = await this.prisma.user.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: { status: 'INACTIVE' },
    });

    return { message: 'User deactivated successfully' };
  }

  async resetPassword(id: string, newPassword: string, companyId: string) {
    const existing = await this.prisma.user.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });

    return { message: 'Password reset successfully' };
  }

  async registerDevice(id: string, deviceId: string, companyId: string, fcmToken?: string) {
    const existing = await this.prisma.user.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: {
        deviceId,
        ...(fcmToken ? { fcmToken } : {}),
      },
    });

    return { message: 'Device registered successfully' };
  }

  async getOnlineUsers(companyId: string) {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

    const activeSessions = await this.prisma.sessionLog.findMany({
      where: {
        isActive: true,
        loginAt: { gte: thirtyMinutesAgo },
        user: { companyId },
      },
      take: clampListLimit(undefined, 200, 200),
      include: {
        user: {
          select: {
            id: true,
            name: true,
            employeeId: true,
            phone: true,
            role: { select: { id: true, name: true, displayName: true } },
            branch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { loginAt: 'desc' },
    });

    const uniqueUsers = new Map();
    for (const session of activeSessions) {
      if (!uniqueUsers.has(session.userId)) {
        uniqueUsers.set(session.userId, {
          ...session.user,
          lastActivity: session.loginAt,
        });
      }
    }

    return Array.from(uniqueUsers.values());
  }

  async getPerformanceStats(
    userId: string,
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const dateFilter: any = {};
    if (dateFrom) {
      dateFilter.gte = new Date(dateFrom);
    }
    if (dateTo) {
      dateFilter.lte = new Date(dateTo + 'T23:59:59.999Z');
    }

    const callWhere: any = { userId, companyId };
    if (Object.keys(dateFilter).length > 0) {
      callWhere.createdAt = dateFilter;
    }

    const [
      totalCalls,
      connectedCalls,
      totalDuration,
      dispositionCounts,
      followUpStats,
      leadsAssigned,
    ] = await Promise.all([
      this.prisma.callRecord.count({ where: callWhere }),
      this.prisma.callRecord.count({
        where: { ...callWhere, category: 'CONNECTED' },
      }),
      this.prisma.callRecord.aggregate({
        where: callWhere,
        _sum: { duration: true },
        _avg: { duration: true },
      }),
      this.prisma.callRecord.groupBy({
        by: ['disposition'],
        where: callWhere,
        _count: { id: true },
      }),
      this.prisma.followUp.groupBy({
        by: ['status'],
        where: {
          userId,
          company: { id: companyId },
          ...(Object.keys(dateFilter).length > 0
            ? { scheduledDate: dateFilter }
            : {}),
        },
        _count: { id: true },
      }),
      this.prisma.lead.count({
        where: { assignedToId: userId, companyId },
      }),
    ]);

    const connectionRate =
      totalCalls > 0 ? ((connectedCalls / totalCalls) * 100).toFixed(1) : '0';

    return {
      userId,
      totalCalls,
      connectedCalls,
      connectionRate: parseFloat(connectionRate),
      totalTalkTime: totalDuration._sum.duration || 0,
      avgCallDuration: Math.round(totalDuration._avg.duration || 0),
      leadsAssigned,
      dailyTarget: user.dailyTarget,
      dispositions: dispositionCounts.map((d) => ({
        disposition: d.disposition,
        count: d._count.id,
      })),
      followUps: followUpStats.map((f) => ({
        status: f.status,
        count: f._count.id,
      })),
    };
  }
}
