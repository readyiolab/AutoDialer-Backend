import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import { SYSTEM_ROLE_PERMISSIONS, ALL_PERMISSIONS } from '../common/constants/permissions';
import {
  buildInviteUrl,
  generateInviteToken,
  hashInviteToken,
  invitationExpiry,
} from '../common/utils/invitation';
import { LeadStatus } from '@prisma/client';
import { clampPage, clampPageSize } from '../common/utils/pagination';

const DEFAULT_LEAD_STATUSES: { code: LeadStatus; label: string; isDialable: boolean; displayOrder: number }[] = [
  { code: 'NEW', label: 'New', isDialable: true, displayOrder: 1 },
  { code: 'ASSIGNED', label: 'Assigned', isDialable: true, displayOrder: 2 },
  { code: 'PENDING', label: 'Pending', isDialable: true, displayOrder: 3 },
  { code: 'NOT_CONTACTED', label: 'Not Contacted', isDialable: true, displayOrder: 4 },
  { code: 'CONTACTED', label: 'Contacted', isDialable: false, displayOrder: 5 },
  { code: 'INTERESTED', label: 'Interested', isDialable: false, displayOrder: 6 },
  { code: 'NOT_INTERESTED', label: 'Not Interested', isDialable: false, displayOrder: 7 },
  { code: 'FOLLOW_UP_REQUIRED', label: 'Follow-up Required', isDialable: true, displayOrder: 8 },
  { code: 'CALL_BACK', label: 'Callback Scheduled', isDialable: true, displayOrder: 9 },
  { code: 'BUSY', label: 'Busy', isDialable: true, displayOrder: 10 },
  { code: 'NO_ANSWER', label: 'No Answer', isDialable: true, displayOrder: 11 },
  { code: 'SWITCHED_OFF', label: 'Switched Off', isDialable: true, displayOrder: 12 },
  { code: 'NOT_REACHABLE', label: 'Not Reachable', isDialable: true, displayOrder: 13 },
  { code: 'INVALID_NUMBER', label: 'Invalid Number', isDialable: false, displayOrder: 14 },
  { code: 'DND', label: 'Do Not Call', isDialable: false, displayOrder: 15 },
  { code: 'EXCLUDED', label: 'Excluded', isDialable: false, displayOrder: 16 },
  { code: 'CONVERTED', label: 'Converted', isDialable: false, displayOrder: 17 },
  { code: 'LOST', label: 'Lost', isDialable: false, displayOrder: 18 },
  { code: 'CLOSED', label: 'Closed', isDialable: false, displayOrder: 19 },
];

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async findAll(page = 1, pageSize = 20, search?: string) {
    const p = clampPage(page);
    const ps = clampPageSize(pageSize);
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        skip: (p - 1) * ps,
        take: ps,
        orderBy: { createdAt: 'desc' },
        include: {
          accountManager: { select: { id: true, name: true, employeeId: true } },
          _count: { select: { users: true, leads: true } },
        },
      }),
      this.prisma.company.count({ where }),
    ]);

    return { data, meta: { total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) } };
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        accountManager: { select: { id: true, name: true, employeeId: true } },
        _count: { select: { users: true, leads: true, campaigns: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async create(dto: CreateCompanyDto, performedById: string) {
    const code = dto.code.toUpperCase().trim();
    const existing = await this.prisma.company.findUnique({ where: { code } });
    if (existing) throw new ConflictException('Company code already exists');

    const placeholderPassword = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const inviteToken = generateInviteToken();
    const tokenHash = hashInviteToken(inviteToken);

    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: dto.name,
          code,
          contactName: dto.contactName || dto.adminName,
          email: dto.email,
          phone: dto.phone,
          address: dto.address,
          accountManagerId: dto.accountManagerId || null,
          subscription: (dto.subscription as any) || {},
          status: 'ACTIVE',
          isActive: true,
        },
      });

      const roleIds = new Map<string, string>();
      for (const [name, permissions] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
        const role = await tx.role.create({
          data: {
            name,
            displayName: name.replace(/_/g, ' '),
            permissions,
            isSystem: true,
            companyId: company.id,
          },
        });
        roleIds.set(name, role.id);
      }

      for (const perm of ALL_PERMISSIONS) {
        await tx.permission.create({
          data: {
            key: perm.key,
            displayName: perm.displayName,
            module: perm.module,
            companyId: company.id,
          },
        });
      }

      for (const s of DEFAULT_LEAD_STATUSES) {
        await tx.leadStatusDefinition.create({
          data: {
            companyId: company.id,
            code: s.code,
            label: s.label,
            isDialable: s.isDialable,
            displayOrder: s.displayOrder,
            isSystem: true,
          },
        });
      }

      await tx.callingRule.create({
        data: {
          name: 'Default',
          companyId: company.id,
          minGapBetweenCalls: 5,
          maxRetriesPerDay: 3,
          maxTotalRetries: 10,
          waitTimeBetweenCalls: 5,
        },
      });

      const admin = await tx.user.create({
        data: {
          employeeId: 'ADM001',
          name: dto.adminName,
          email: dto.adminEmail || dto.email,
          phone: dto.adminPhone,
          password: placeholderPassword,
          roleId: roleIds.get('COMPANY_ADMIN')!,
          companyId: company.id,
          status: 'ACTIVE',
        },
      });

      const invitation = await tx.invitation.create({
        data: {
          userId: admin.id,
          tokenHash,
          email: admin.email!,
          expiresAt: invitationExpiry(48),
          status: 'PENDING',
        },
      });

      return { company, admin, invitation };
    });

    const inviteUrl = buildInviteUrl(inviteToken);
    const mailResult = await this.mail.sendInvitationEmail({
      to: result.admin.email!,
      name: result.admin.name,
      companyName: result.company.name,
      inviteUrl,
    });

    await this.prisma.invitation.update({
      where: { id: result.invitation.id },
      data: mailResult.sent
        ? { emailSentAt: new Date(), emailFailed: false }
        : { emailFailed: true, emailError: mailResult.error },
    });

    await this.audit.logAction({
      userId: performedById,
      action: 'COMPANY_CREATE',
      entity: 'Company',
      entityId: result.company.id,
      companyId: result.company.id,
      newValues: { name: result.company.name, code: result.company.code },
    });

    return {
      company: result.company,
      admin: {
        id: result.admin.id,
        name: result.admin.name,
        email: result.admin.email,
        phone: result.admin.phone,
      },
      invitationSent: mailResult.sent,
    };
  }

  async update(id: string, dto: UpdateCompanyDto, performedById: string) {
    const company = await this.findOne(id);
    const data: any = { ...dto };
    if (dto.status) {
      data.isActive = dto.status === 'ACTIVE';
    }

    const updated = await this.prisma.company.update({
      where: { id },
      data,
    });

    await this.audit.logAction({
      userId: performedById,
      action: 'COMPANY_UPDATE',
      entity: 'Company',
      entityId: id,
      companyId: id,
      oldValues: { status: company.status, name: company.name },
      newValues: dto,
    });

    return updated;
  }

  async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE', performedById: string) {
    if (!['ACTIVE', 'SUSPENDED', 'INACTIVE'].includes(status)) {
      throw new BadRequestException('Invalid status');
    }
    return this.update(id, { status }, performedById);
  }
}
