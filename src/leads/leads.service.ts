import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { AllocateLeadsDto, TransferLeadsDto } from './dto/allocate-leads.dto';
import { LeadStatus, LeadSource } from '@prisma/client';
import * as xlsx from 'xlsx';
import { clampPage, clampPageSize, clampListLimit } from '../common/utils/pagination';
import { buildAssignmentPlan } from './allocation.engine';
import { QueueModule } from '../queue/queue.module';
import { ImportProcessor } from '../queue/import.processor';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';

const MAX_IMPORT_ROWS = 50000;
const LEAD_DETAIL_LIMIT = 50;

const FIELD_ALIASES: Record<string, string[]> = {
  customerName: ['Customer Name', 'Name', 'name', 'customer_name', 'Full Name'],
  mobileNumber: ['Mobile Number', 'mobile', 'phone', 'Mobile', 'Phone Number', 'mobile_number'],
  email: ['Email', 'email', 'Email Address'],
  panNumber: ['PAN', 'Pan', 'pan', 'PAN Number', 'Pan Number', 'pan_number', 'panNumber'],
  aadhaarNumber: [
    'Aadhaar',
    'Aadhar',
    'aadhaar',
    'aadhar',
    'Aadhaar Number',
    'Aadhar Number',
    'aadhaar_number',
    'aadhaarNumber',
  ],
  city: ['City', 'city'],
  state: ['State', 'state'],
  address: ['Address', 'address'],
  loanAmount: ['Loan Amount', 'Amount', 'loan_amount', 'amount'],
  product: ['Product', 'product'],
  employer: ['Employer', 'employer', 'Company'],
};

@Injectable()
export class LeadsService {
  constructor(
    private prisma: PrismaService,
    private importProcessor: ImportProcessor,
    private realtime: RealtimeGateway,
    private notifications: NotificationsService,
  ) {}

  private normalizePan(raw?: string | null): string | null {
    if (raw == null || String(raw).trim() === '') return null;
    return String(raw).trim().toUpperCase();
  }

  private normalizeAadhaar(raw?: string | null): string | null {
    if (raw == null || String(raw).trim() === '') return null;
    return String(raw).replace(/\D/g, '');
  }

  async create(createLeadDto: CreateLeadDto, companyId: string) {
    const existing = await this.prisma.lead.findFirst({
      where: { mobileNumber: createLeadDto.mobileNumber },
    });

    if (existing) {
      throw new BadRequestException(
        'This mobile number is already registered',
      );
    }

    return this.prisma.lead.create({
      data: {
        ...createLeadDto,
        panNumber: this.normalizePan(createLeadDto.panNumber),
        aadhaarNumber: this.normalizeAadhaar(createLeadDto.aadhaarNumber),
        companyId,
      },
      include: { assignedTo: { select: { id: true, name: true } }, campaign: true },
    });
  }

  async findAll(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: LeadStatus;
    campaignId?: string;
    assignedToId?: string;
    city?: string;
    priority?: any;
    dateFrom?: string;
    dateTo?: string;
    companyId: string;
  }) {
    const page = clampPage(params.page);
    const pageSize = clampPageSize(params.pageSize);
    const skip = (page - 1) * pageSize;
    const { search, status, campaignId, assignedToId, city, priority, dateFrom, dateTo, companyId } =
      params;

    const where: any = { companyId };

    if (search) {
      where.OR = [
        { customerName: { contains: search, mode: 'insensitive' } },
        { mobileNumber: { contains: search } },
        { city: { contains: search, mode: 'insensitive' } },
        { loanId: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) where.status = status;
    if (campaignId) where.campaignId = campaignId;
    if (assignedToId === 'null' || assignedToId === 'unassigned') {
      where.assignedToId = null;
    } else if (assignedToId) {
      where.assignedToId = assignedToId;
    }
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (priority) where.priority = priority;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [total, data] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, name: true, employeeId: true } },
          campaign: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(
    id: string,
    companyId: string,
    opts?: { requesterId?: string; roleName?: string },
  ) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, companyId },
      include: {
        assignedTo: { select: { id: true, name: true, phone: true, employeeId: true } },
        campaign: true,
        callRecords: {
          take: LEAD_DETAIL_LIMIT,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, name: true } } },
        },
        followUps: {
          take: LEAD_DETAIL_LIMIT,
          orderBy: { scheduledDate: 'desc' },
          include: { user: { select: { id: true, name: true } } },
        },
        communicationLogs: {
          take: LEAD_DETAIL_LIMIT,
          orderBy: { createdAt: 'desc' },
          include: { template: true },
        },
        statusHistory: {
          take: LEAD_DETAIL_LIMIT,
          orderBy: { createdAt: 'desc' },
          include: { changedBy: { select: { id: true, name: true } } },
        },
        _count: {
          select: {
            callRecords: true,
            followUps: true,
            communicationLogs: true,
            statusHistory: true,
          },
        },
      },
    });

    if (!lead) throw new NotFoundException(`Lead with ID ${id} not found.`);
    if (
      opts?.roleName === 'TELECALLER' &&
      opts.requesterId &&
      lead.assignedToId !== opts.requesterId
    ) {
      throw new ForbiddenException('You can only access leads assigned to you');
    }
    return lead;
  }

  async update(
    id: string,
    updateLeadDto: UpdateLeadDto,
    companyId: string,
    userId?: string,
    opts?: { roleName?: string },
  ) {
    const lead = await this.prisma.lead.findFirst({ where: { id, companyId } });
    if (!lead) throw new NotFoundException(`Lead with ID ${id} not found.`);
    if (
      opts?.roleName === 'TELECALLER' &&
      userId &&
      lead.assignedToId !== userId
    ) {
      throw new ForbiddenException('You can only update leads assigned to you');
    }

    return this.prisma.$transaction(async (tx) => {
      if (updateLeadDto.status && updateLeadDto.status !== lead.status && userId) {
        await tx.leadStatusHistory.create({
          data: {
            leadId: id,
            fromStatus: lead.status,
            toStatus: updateLeadDto.status,
            changedById: userId,
            remarks: 'Status updated via lead management',
          },
        });
      }

      const data: Record<string, unknown> = { ...updateLeadDto };
      if (Object.prototype.hasOwnProperty.call(updateLeadDto, 'panNumber')) {
        data.panNumber = this.normalizePan(updateLeadDto.panNumber);
      }
      if (Object.prototype.hasOwnProperty.call(updateLeadDto, 'aadhaarNumber')) {
        data.aadhaarNumber = this.normalizeAadhaar(updateLeadDto.aadhaarNumber);
      }

      return tx.lead.update({
        where: { id },
        data,
      });
    });
  }

  private async assertLeadsInCompany(leadIds: string[], companyId: string) {
    const count = await this.prisma.lead.count({
      where: { id: { in: leadIds }, companyId },
    });
    if (count !== leadIds.length) {
      throw new ForbiddenException('One or more leads do not belong to this company');
    }
  }

  private async assertUsersInCompany(userIds: string[], companyId: string) {
    const uniqueIds = Array.from(new Set(userIds));
    const count = await this.prisma.user.count({
      where: { id: { in: uniqueIds }, companyId, status: 'ACTIVE' },
    });
    if (count !== uniqueIds.length) {
      throw new ForbiddenException('One or more users do not belong to this company');
    }
  }

  private async prepareAllocationPlan(dto: AllocateLeadsDto, companyId: string) {
    if (dto.campaignId) {
      const campaign = await this.prisma.campaign.findFirst({
        where: { id: dto.campaignId, companyId },
      });
      if (!campaign) throw new NotFoundException('Campaign not found');
      if (campaign.status === 'PAUSED') {
        throw new BadRequestException('Campaign allocation is paused');
      }
    }

    let userIds = dto.userIds || [];
    const hasExplicitUsers = Array.isArray(dto.userIds) && dto.userIds.length > 0;

    if (dto.teamId) {
      const teamUsers = await this.prisma.user.findMany({
        where: { companyId, teamId: dto.teamId, status: 'ACTIVE' },
        select: { id: true },
      });
      userIds = Array.from(new Set([...userIds, ...teamUsers.map((u) => u.id)]));
    }

    // Prefer active CampaignAssignment members when campaignId set and no explicit users
    if (dto.campaignId && !hasExplicitUsers && !dto.teamId) {
      const members = await this.prisma.campaignAssignment.findMany({
        where: {
          campaignId: dto.campaignId,
          user: { companyId, status: 'ACTIVE' },
        },
        select: { userId: true },
      });
      userIds = members.map((m) => m.userId);
    }

    if (!userIds.length) {
      throw new BadRequestException(
        dto.campaignId
          ? 'No active telecallers assigned to this campaign'
          : 'At least one telecaller or team is required',
      );
    }
    await this.assertUsersInCompany(userIds, companyId);

    if (dto.campaignId) {
      const assigned = await this.prisma.campaignAssignment.findMany({
        where: {
          campaignId: dto.campaignId,
          userId: { in: userIds },
          user: { companyId, status: 'ACTIVE' },
        },
        select: { userId: true },
      });
      const allowed = new Set(assigned.map((a) => a.userId));
      const outsiders = userIds.filter((id) => !allowed.has(id));
      if (outsiders.length) {
        throw new ForbiddenException(
          'One or more users are not assigned to this campaign. Assign them to the campaign first.',
        );
      }
      userIds = userIds.filter((id) => allowed.has(id));
    }

    if (dto.leadIds?.length) {
      await this.assertLeadsInCompany(dto.leadIds, companyId);
    }

    if (dto.targetCounts) {
      const sum = Object.values(dto.targetCounts).reduce((s, n) => s + Number(n || 0), 0);
      if (sum <= 0) {
        throw new BadRequestException('targetCounts must sum to a positive number');
      }
    }

    const leadWhere: any = { companyId };
    if (dto.leadIds?.length) {
      leadWhere.id = { in: dto.leadIds };
    } else if (dto.onlyUnassigned !== false) {
      leadWhere.assignedToId = null;
      if (dto.campaignId) leadWhere.campaignId = dto.campaignId;
    } else if (dto.campaignId) {
      leadWhere.campaignId = dto.campaignId;
    }

    const leads = await this.prisma.lead.findMany({
      where: leadWhere,
      select: { id: true, priority: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 10000,
    });
    if (!leads.length) throw new BadRequestException('No leads to allocate');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const openStatuses = ['NEW', 'ASSIGNED', 'PENDING', 'NOT_CONTACTED', 'CALL_BACK'] as const;

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, companyId },
      select: { id: true, dailyTarget: true, name: true, employeeId: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const [openGroups, connectedGroups, convertedGroups, openBreaks] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['assignedToId'],
        where: {
          companyId,
          assignedToId: { in: userIds },
          status: { in: openStatuses as any },
        },
        _count: { id: true },
      }),
      this.prisma.callRecord.groupBy({
        by: ['userId'],
        where: {
          companyId,
          userId: { in: userIds },
          category: 'CONNECTED',
          createdAt: { gte: weekAgo },
        },
        _count: { id: true },
      }),
      this.prisma.lead.groupBy({
        by: ['assignedToId'],
        where: {
          companyId,
          assignedToId: { in: userIds },
          status: 'CONVERTED',
          updatedAt: { gte: weekAgo },
        },
        _count: { id: true },
      }),
      dto.excludeOnBreak
        ? this.prisma.breakLog.findMany({
            where: {
              endTime: null,
              attendance: { companyId, date: today, userId: { in: userIds } },
            },
            select: { attendance: { select: { userId: true } } },
          })
        : Promise.resolve([] as Array<{ attendance: { userId: string } }>),
    ]);

    const openMap = new Map(openGroups.map((g) => [g.assignedToId!, g._count.id]));
    const connectedMap = new Map(connectedGroups.map((g) => [g.userId, g._count.id]));
    const convertedMap = new Map(convertedGroups.map((g) => [g.assignedToId!, g._count.id]));
    const onBreakSet = new Set(openBreaks.map((b) => b.attendance.userId));

    const agents = userIds.map((userId) => {
      const user = userMap.get(userId);
      return {
        userId,
        name: user?.name || userId,
        employeeId: user?.employeeId || null,
        openLeads: openMap.get(userId) || 0,
        dailyTarget: user?.dailyTarget || 100,
        connected: connectedMap.get(userId) || 0,
        converted: convertedMap.get(userId) || 0,
        onBreak: dto.excludeOnBreak ? onBreakSet.has(userId) : false,
        percentage: dto.percentages?.[userId],
      };
    });

    const plan = buildAssignmentPlan(leads, agents, dto.method, {
      maxPerUser: dto.maxPerUser,
      percentages: dto.percentages,
      manualMap: dto.manualMap,
      targetCounts: dto.targetCounts,
    });

    return { leads, agents, plan, userIds };
  }

  async previewAllocate(dto: AllocateLeadsDto, companyId: string) {
    const { leads, agents, plan } = await this.prepareAllocationPlan(dto, companyId);
    const counts: Record<string, number> = {};
    for (const userId of plan.values()) {
      counts[userId] = (counts[userId] || 0) + 1;
    }
    const distribution = agents.map((a) => ({
      userId: a.userId,
      name: a.name,
      employeeId: a.employeeId,
      plannedCount: counts[a.userId] || 0,
      openLeads: a.openLeads,
      onBreak: a.onBreak,
    }));
    return {
      totalLeads: leads.length,
      plannedTotal: plan.size,
      distribution,
    };
  }

  async allocate(dto: AllocateLeadsDto, companyId: string, performedById: string) {
    const { leads, plan } = await this.prepareAllocationPlan(dto, companyId);

    if (!plan.size) {
      throw new BadRequestException('No eligible agents for allocation');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.allocationBatch.create({
        data: {
          companyId,
          campaignId: dto.campaignId || null,
          method: dto.method as any,
          ruleSnapshot: {
            maxPerUser: dto.maxPerUser,
            percentages: dto.percentages,
            teamId: dto.teamId,
            hybridRules: dto.hybridRules,
          } as any,
          totalLeads: leads.length,
          allocated: 0,
          performedById,
        },
      });

      let allocated = 0;
      for (const [leadId, userId] of plan.entries()) {
        const locked: Array<{ id: string }> = await tx.$queryRaw`
          SELECT id FROM leads
          WHERE id = ${leadId} AND \`companyId\` = ${companyId}
          FOR UPDATE SKIP LOCKED
        `;
        if (!locked.length) continue;

        const updated = await tx.lead.updateMany({
          where: {
            id: leadId,
            companyId,
            ...(dto.onlyUnassigned !== false ? { assignedToId: null } : {}),
          },
          data: {
            assignedToId: userId,
            status: 'ASSIGNED',
            allocationBatchId: batch.id,
            ...(dto.campaignId ? { campaignId: dto.campaignId } : {}),
          },
        });
        if (updated.count === 0) continue;

        await tx.leadStatusHistory.create({
          data: {
            leadId,
            fromStatus: 'NEW',
            toStatus: 'ASSIGNED',
            changedById: performedById,
            remarks: `Allocated via ${dto.method}`,
          },
        });

        await tx.leadAssignmentHistory.create({
          data: {
            leadId,
            companyId,
            fromUserId: null,
            toUserId: userId,
            assignedById: performedById,
            reason: 'ALLOCATE',
            remarks: `Allocated via ${dto.method}`,
            source: 'ALLOCATE',
          },
        });

        if (dto.campaignId) {
          // Membership must already exist — never upsert non-members during allocate
          await tx.campaignAssignment.update({
            where: { campaignId_userId: { campaignId: dto.campaignId, userId } },
            data: { leadsAssigned: { increment: 1 } },
          });
        }
        allocated++;
      }

      await tx.allocationBatch.update({
        where: { id: batch.id },
        data: { allocated },
      });

      await tx.auditLog.create({
        data: {
          userId: performedById,
          action: 'LEAD_ALLOCATE',
          entity: 'AllocationBatch',
          entityId: batch.id,
          companyId,
          newValues: { method: dto.method, allocated, total: leads.length },
        },
      });

      return { batchId: batch.id, allocated, totalLeads: leads.length };
    });

    this.realtime.emitToCompany(companyId, 'allocation:complete', result);
    await this.notifications.notify({
      userId: performedById,
      companyId,
      title: 'Lead allocation complete',
      body: `Allocated ${result.allocated} of ${result.totalLeads} leads`,
      type: 'ALLOCATION_COMPLETE',
      metadata: result,
    });

    return { success: true, ...result };
  }

  async transfer(dto: TransferLeadsDto, companyId: string, performedById: string) {
    const { toUserId, remarks, reason, allowProtectedOverride, campaignId } = dto;
    const explicitLeadIds = Array.isArray(dto.leadIds)
      ? dto.leadIds.filter((id) => typeof id === 'string' && id.trim())
      : [];
    const count = dto.count != null ? Number(dto.count) : 0;

    if (!explicitLeadIds.length && !(dto.fromUserId && count > 0)) {
      throw new BadRequestException(
        'Provide leadIds, or fromUserId with count, to transfer leads',
      );
    }

    const userIdsToCheck = [toUserId, dto.fromUserId].filter(Boolean) as string[];
    await this.assertUsersInCompany(userIdsToCheck, companyId);

    if (campaignId) {
      const campaign = await this.prisma.campaign.findFirst({
        where: { id: campaignId, companyId },
      });
      if (!campaign) throw new NotFoundException('Campaign not found');

      const memberIds = (
        await this.prisma.campaignAssignment.findMany({
          where: { campaignId },
          select: { userId: true },
        })
      ).map((m) => m.userId);

      if (!memberIds.includes(toUserId)) {
        throw new ForbiddenException(
          'Destination telecaller is not assigned to this campaign. Assign them to the campaign first.',
        );
      }
      if (dto.fromUserId && !memberIds.includes(dto.fromUserId)) {
        throw new ForbiddenException(
          'Source telecaller is not assigned to this campaign.',
        );
      }
    }

    const protectedStatuses = ['INTERESTED', 'CONVERTED', 'APPLICATION_SUBMITTED'];
    let leadIds = explicitLeadIds;

    if (!leadIds.length) {
      const where: any = {
        companyId,
        assignedToId: dto.fromUserId,
        isBlacklisted: false,
      };
      if (campaignId) where.campaignId = campaignId;
      if (!allowProtectedOverride) {
        where.status = { notIn: protectedStatuses };
      }
      const picked = await this.prisma.lead.findMany({
        where,
        select: { id: true },
        orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
        take: count,
      });
      leadIds = picked.map((l) => l.id);
      if (!leadIds.length) {
        throw new BadRequestException('No eligible leads found to transfer');
      }
    }

    await this.assertLeadsInCompany(leadIds, companyId);

    let transferred = 0;
    let skippedProtected = 0;
    const movedLeadIds: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const leadId of leadIds) {
        const locked: Array<{
          id: string;
          assignedToId: string | null;
          status: string;
          campaignId: string | null;
        }> = await tx.$queryRaw`
          SELECT id, \`assignedToId\`, status, \`campaignId\` FROM leads
          WHERE id = ${leadId} AND \`companyId\` = ${companyId}
          FOR UPDATE SKIP LOCKED
        `;
        if (!locked.length) continue;
        const lead = locked[0];
        if (campaignId && lead.campaignId && lead.campaignId !== campaignId) {
          continue;
        }
        if (campaignId && !lead.campaignId) {
          continue;
        }
        if (dto.fromUserId && lead.assignedToId && lead.assignedToId !== dto.fromUserId) {
          continue;
        }
        if (protectedStatuses.includes(lead.status) && !allowProtectedOverride) {
          skippedProtected++;
          continue;
        }
        if (lead.assignedToId === toUserId) continue;

        const fromUserId = lead.assignedToId;
        const nextStatus = (lead.status === 'NEW' ? 'ASSIGNED' : lead.status) as any;
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            assignedToId: toUserId,
            status: nextStatus,
            needsReview: false,
          },
        });
        await tx.leadStatusHistory.create({
          data: {
            leadId: lead.id,
            fromStatus: lead.status,
            toStatus: nextStatus,
            changedById: performedById,
            remarks: remarks || reason || 'Lead transferred',
          },
        });
        await tx.leadAssignmentHistory.create({
          data: {
            leadId: lead.id,
            companyId,
            fromUserId,
            toUserId,
            assignedById: performedById,
            reason: reason || 'TRANSFER',
            remarks: remarks || null,
            source: reason ? 'REASSIGN' : 'TRANSFER',
          },
        });

        const counterCampaignId = lead.campaignId || campaignId || null;
        if (counterCampaignId) {
          if (fromUserId) {
            await tx.campaignAssignment.updateMany({
              where: {
                campaignId: counterCampaignId,
                userId: fromUserId,
                leadsAssigned: { gt: 0 },
              },
              data: { leadsAssigned: { decrement: 1 } },
            });
          }
          await tx.campaignAssignment.updateMany({
            where: { campaignId: counterCampaignId, userId: toUserId },
            data: { leadsAssigned: { increment: 1 } },
          });
        }

        transferred++;
        movedLeadIds.push(lead.id);
      }

      await tx.auditLog.create({
        data: {
          userId: performedById,
          action: 'LEAD_TRANSFER',
          entity: 'Lead',
          companyId,
          newValues: {
            transferred,
            skippedProtected,
            toUserId,
            fromUserId: dto.fromUserId,
            campaignId,
            count: dto.count,
            remarks,
            reason,
            leadIds: movedLeadIds,
          },
        },
      });
    });

    if (transferred > 0) {
      await this.notifications.notify({
        userId: toUserId,
        companyId,
        title: 'Leads reassigned to you',
        body: `${transferred} lead(s) were assigned to your queue`,
        type: 'LEAD_REASSIGNED',
        metadata: { transferred, reason, campaignId },
      });
    }

    return {
      success: true,
      transferred,
      skippedProtected,
      leadIds: movedLeadIds,
    };
  }

  async listUnworked(
    companyId: string,
    query: {
      bucket?: string;
      assignedToId?: string;
      idleDays?: number;
      unansweredMin?: number;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);
    const idleDays = Number(query.idleDays || 2);
    const unansweredMin = Number(query.unansweredMin || 3);
    const bucket = (query.bucket || 'ALL').toUpperCase();
    const idleSince = new Date(Date.now() - idleDays * 86400000);
    const now = new Date();

    const where: any = {
      companyId,
      assignedToId: { not: null },
      isBlacklisted: false,
      status: { notIn: ['CONVERTED', 'CLOSED', 'DND', 'LOST'] },
    };
    if (query.assignedToId) where.assignedToId = query.assignedToId;

    switch (bucket) {
      case 'NEVER_CALLED':
        where.totalAttempts = 0;
        where.lastContactedAt = null;
        break;
      case 'IDLE':
        where.OR = [
          { lastContactedAt: { lt: idleSince } },
          { AND: [{ lastContactedAt: null }, { updatedAt: { lt: idleSince } }] },
        ];
        break;
      case 'OVERDUE_FOLLOWUP':
        where.nextFollowUpAt = { lt: now };
        where.status = { in: ['CALL_BACK', 'FOLLOW_UP_REQUIRED', 'INTERESTED', 'ASSIGNED'] };
        break;
      case 'INACTIVE_ASSIGNEE':
        where.assignedTo = { status: { not: 'ACTIVE' } };
        break;
      case 'UNANSWERED_STREAK':
        where.totalAttempts = { gte: unansweredMin };
        where.connectedCalls = 0;
        break;
      case 'NEEDS_REVIEW':
        where.needsReview = true;
        break;
      default:
        // All issues = reclaim targets only (not the full fresh never-called queue)
        where.OR = [
          {
            AND: [
              { totalAttempts: 0 },
              { lastContactedAt: null },
              { updatedAt: { lt: idleSince } },
            ],
          },
          { lastContactedAt: { lt: idleSince } },
          { nextFollowUpAt: { lt: now } },
          { needsReview: true },
          { assignedTo: { status: { not: 'ACTIVE' } } },
          { totalAttempts: { gte: unansweredMin }, connectedCalls: 0 },
        ];
        break;
    }

    const [rows, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          assignedTo: { select: { id: true, name: true, employeeId: true, status: true } },
          campaign: { select: { id: true, name: true } },
        },
        orderBy: [{ updatedAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    const data = rows.map((lead) => {
      const issues: string[] = [];
      const neverCalled = lead.totalAttempts === 0 && !lead.lastContactedAt;
      const idle =
        (lead.lastContactedAt && lead.lastContactedAt < idleSince) ||
        (!lead.lastContactedAt && lead.updatedAt < idleSince);
      if (neverCalled && idle) issues.push('Idle never called');
      else if (neverCalled) issues.push('Never called');
      else if (idle) issues.push('Idle');
      if (lead.nextFollowUpAt && lead.nextFollowUpAt < now) issues.push('Overdue FU');
      if (lead.needsReview) issues.push('Needs review');
      if (lead.assignedTo && lead.assignedTo.status !== 'ACTIVE') issues.push('Inactive assignee');
      if (lead.totalAttempts >= unansweredMin && lead.connectedCalls === 0) {
        issues.push(`${unansweredMin}+ unanswered`);
      }
      return { ...lead, issues };
    });

    return {
      data,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1, bucket },
    };
  }

  async assignmentHistory(leadId: string, companyId: string) {
    await this.assertLeadsInCompany([leadId], companyId);
    return this.prisma.leadAssignmentHistory.findMany({
      where: { leadId, companyId },
      include: {
        fromUser: { select: { id: true, name: true, employeeId: true } },
        toUser: { select: { id: true, name: true, employeeId: true } },
        assignedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private normalizeMobile(raw: string): string {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    return digits;
  }

  private suggestMapping(headers: string[]): Record<string, string> {
    const mapping: Record<string, string> = {};
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      const found = headers.find((h) =>
        aliases.some((a) => a.toLowerCase() === String(h).toLowerCase()),
      );
      if (found) mapping[field] = found;
    }
    return mapping;
  }

  private getMappedValue(row: any, mapping: Record<string, string>, field: string) {
    const col = mapping[field];
    if (!col) return undefined;
    return row[col];
  }

  async parseExcelBuffer(
    buffer: Buffer,
    fileName: string,
    companyId: string,
    userId: string,
    campaignId?: string,
    columnMapping?: Record<string, string>,
  ) {
    if (!campaignId?.trim()) {
      throw new BadRequestException('campaignId is required for Excel import');
    }
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, companyId },
      select: { id: true },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found for this company');
    }

    const fileHash = createHash('sha256').update(buffer).digest('hex');
    const dupFile = await this.prisma.importHistory.findFirst({
      where: { companyId, fileHash, status: { in: ['PROCESSING', 'COMPLETED'] } },
    });
    if (dupFile) {
      throw new BadRequestException('This file was already imported for this company');
    }

    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows: any[] = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (rawRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`Excel import is limited to ${MAX_IMPORT_ROWS} rows`);
    }
    if (!rawRows.length) throw new BadRequestException('File has no data rows');

    const headers = Object.keys(rawRows[0] || {});
    const mapping = columnMapping && Object.keys(columnMapping).length
      ? columnMapping
      : this.suggestMapping(headers);

    if (!mapping.customerName || !mapping.mobileNumber) {
      return {
        needsMapping: true,
        headers,
        suggestedMapping: mapping,
        sampleRows: rawRows.slice(0, 5),
        total: rawRows.length,
      };
    }

    const phoneRegex = /^[6-9]\d{9}$/;
    const validRecords: any[] = [];
    const duplicateRecords: any[] = [];
    const rejectedRecords: any[] = [];
    const mobilesInFile: string[] = [];

    for (const row of rawRows) {
      const mobile = this.normalizeMobile(
        String(this.getMappedValue(row, mapping, 'mobileNumber') || ''),
      );
      if (phoneRegex.test(mobile)) mobilesInFile.push(mobile);
    }

    const existingMobiles = new Set(
      (
        await this.prisma.lead.findMany({
          where: { mobileNumber: { in: Array.from(new Set(mobilesInFile)) } },
          select: { mobileNumber: true },
        })
      ).map((l) => l.mobileNumber),
    );

    const seenInFile = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const mobile = this.normalizeMobile(
        String(this.getMappedValue(row, mapping, 'mobileNumber') || ''),
      );
      const customerName = String(
        this.getMappedValue(row, mapping, 'customerName') || '',
      ).trim();
      const loanRaw = this.getMappedValue(row, mapping, 'loanAmount');
      const loanAmount = loanRaw !== undefined && loanRaw !== '' ? parseFloat(String(loanRaw)) : null;

      if (!customerName) {
        rejectedRecords.push({ row: i + 2, reason: 'Missing customer name', rawData: row });
        continue;
      }
      if (!phoneRegex.test(mobile)) {
        rejectedRecords.push({
          row: i + 2,
          reason: 'Invalid 10-digit Indian mobile number',
          rawData: row,
        });
        continue;
      }
      if (existingMobiles.has(mobile) || seenInFile.has(mobile)) {
        duplicateRecords.push({
          row: i + 2,
          mobile,
          name: customerName,
          reason: existingMobiles.has(mobile) ? 'Exists in database' : 'Duplicate in file',
        });
        continue;
      }

      seenInFile.add(mobile);
      const known = new Set(Object.values(mapping));
      const customFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (!known.has(k) && v !== '' && v != null) customFields[k] = v;
      }

      const panNumber = this.normalizePan(
        String(this.getMappedValue(row, mapping, 'panNumber') || ''),
      );
      const aadhaarNumber = this.normalizeAadhaar(
        String(this.getMappedValue(row, mapping, 'aadhaarNumber') || ''),
      );

      validRecords.push({
        customerName,
        mobileNumber: mobile,
        email: this.getMappedValue(row, mapping, 'email') || null,
        panNumber,
        aadhaarNumber,
        city: this.getMappedValue(row, mapping, 'city') || null,
        state: this.getMappedValue(row, mapping, 'state') || null,
        address: this.getMappedValue(row, mapping, 'address') || null,
        loanAmount: Number.isFinite(loanAmount as number) ? loanAmount : null,
        product: this.getMappedValue(row, mapping, 'product') || null,
        employer: this.getMappedValue(row, mapping, 'employer') || null,
        customFields,
        source: LeadSource.EXCEL_UPLOAD,
      });
    }

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    fs.mkdirSync(uploadDir, { recursive: true });
    const storedName = `${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filePath = path.join(uploadDir, storedName);
    fs.writeFileSync(filePath, buffer);

    const rejectedPath = this.importProcessor.writeRejectedFile(
      rejectedRecords.map((r) => ({ row: r.row, reason: r.reason, ...(r.rawData || {}) })),
      `tmp-${Date.now()}`,
    );

    const importHistory = await this.prisma.importHistory.create({
      data: {
        fileName,
        fileType: fileName.toLowerCase().endsWith('.csv') ? 'CSV' : 'EXCEL',
        fileHash,
        filePath,
        columnMapping: mapping,
        stagedRows: validRecords,
        totalRecords: rawRows.length,
        importedRecords: 0,
        duplicateRecords: duplicateRecords.length,
        rejectedRecords: rejectedRecords.length,
        rejectedFileUrl: rejectedPath,
        progress: 0,
        status: 'PROCESSING',
        uploadedById: userId,
        campaignId,
        companyId,
      },
    });

    if (rejectedPath) {
      const finalRejected = this.importProcessor.writeRejectedFile(
        rejectedRecords.map((r) => ({ row: r.row, reason: r.reason, ...(r.rawData || {}) })),
        importHistory.id,
      );
      await this.prisma.importHistory.update({
        where: { id: importHistory.id },
        data: { rejectedFileUrl: finalRejected },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LEAD_IMPORT_UPLOAD',
        entity: 'ImportHistory',
        entityId: importHistory.id,
        companyId,
        newValues: {
          fileName,
          campaignId,
          valid: validRecords.length,
          duplicates: duplicateRecords.length,
          rejected: rejectedRecords.length,
        },
      },
    });

    return {
      importHistoryId: importHistory.id,
      headers,
      suggestedMapping: mapping,
      total: rawRows.length,
      validCount: validRecords.length,
      duplicateCount: duplicateRecords.length,
      rejectedCount: rejectedRecords.length,
      preview: validRecords.slice(0, 20),
      duplicates: duplicateRecords.slice(0, 20),
      rejected: rejectedRecords.slice(0, 20),
      needsMapping: false,
    };
  }

  async confirmImport(
    importHistoryId: string,
    companyId: string,
    userId: string,
    columnMapping?: Record<string, string>,
  ) {
    const history = await this.prisma.importHistory.findFirst({
      where: { id: importHistoryId, companyId },
    });
    if (!history) throw new NotFoundException('Import history not found');
    if (history.status === 'COMPLETED') {
      return { success: true, alreadyCompleted: true, count: history.importedRecords };
    }
    if (history.status === 'CANCELLED') {
      throw new BadRequestException('Import was cancelled');
    }
    if (!history.campaignId) {
      throw new BadRequestException(
        'Import has no campaignId — re-upload with a campaign before confirming',
      );
    }

    if (columnMapping && history.filePath && fs.existsSync(history.filePath)) {
      const buffer = fs.readFileSync(history.filePath);
      await this.prisma.importHistory.delete({ where: { id: importHistoryId } });
      const reparsed = await this.parseExcelBuffer(
        buffer,
        history.fileName,
        companyId,
        userId,
        history.campaignId,
        columnMapping,
      );
      if ((reparsed as any).needsMapping) return reparsed;
      importHistoryId = (reparsed as any).importHistoryId;
    }

    const stagedCount = Array.isArray(history.stagedRows) ? history.stagedRows.length : history.totalRecords || 0;
    const requireRedis = process.env.NODE_ENV === 'production' || stagedCount > 500;
    const queued = await QueueModule.enqueueImport({ importHistoryId, companyId });
    if (!queued.queued) {
      if (requireRedis) {
        throw new BadRequestException(
          'Redis is required for large/production imports. Set REDIS_URL or REDIS_HOST/REDIS_PASSWORD (Upstash) and retry.',
        );
      }
      const result = await this.importProcessor.commitImport(importHistoryId, companyId);
      this.realtime.emitToCompany(companyId, 'import:complete', { importHistoryId, ...result });
      await this.notifications.notify({
        userId,
        companyId,
        title: 'Lead import complete',
        body: `Imported ${(result as any).imported || 0} leads`,
        type: 'IMPORT_COMPLETE',
        metadata: { importHistoryId, ...result },
      });
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'LEAD_IMPORT_CONFIRM',
          entity: 'ImportHistory',
          entityId: importHistoryId,
          companyId,
          newValues: result,
        },
      });
      return { success: true, queued: false, ...result };
    }

    this.realtime.emitToCompany(companyId, 'import:queued', { importHistoryId });
    return { success: true, queued: true, importHistoryId };
  }

  async cancelImport(importHistoryId: string, companyId: string, userId: string) {
    const history = await this.prisma.importHistory.findFirst({
      where: { id: importHistoryId, companyId },
    });
    if (!history) throw new NotFoundException('Import history not found');
    if (history.status === 'COMPLETED') {
      throw new BadRequestException('Cannot cancel a completed import; reassign leads instead');
    }
    await this.prisma.importHistory.update({
      where: { id: importHistoryId },
      data: { status: 'CANCELLED', stagedRows: [], completedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'LEAD_IMPORT_CANCEL',
        entity: 'ImportHistory',
        entityId: importHistoryId,
        companyId,
      },
    });
    return { success: true, cancelled: true };
  }

  async getImportStatus(importHistoryId: string, companyId: string) {
    const history = await this.prisma.importHistory.findFirst({
      where: { id: importHistoryId, companyId },
      select: {
        id: true,
        status: true,
        progress: true,
        totalRecords: true,
        importedRecords: true,
        duplicateRecords: true,
        rejectedRecords: true,
        rejectedFileUrl: true,
        completedAt: true,
        fileName: true,
      },
    });
    if (!history) throw new NotFoundException('Import history not found');
    return history;
  }

  async extractFromOcr(imageText: string, companyId: string) {
    const phoneRegex = /\b[6-9]\d{9}\b/g;
    const matches = imageText.match(phoneRegex) || [];
    const uniquePhones = Array.from(new Set(matches));

    const existingMobiles = new Set(
      (
        await this.prisma.lead.findMany({
          where: { mobileNumber: { in: uniquePhones } },
          select: { mobileNumber: true },
        })
      ).map((l) => l.mobileNumber),
    );

    const results = uniquePhones.map((phone) => ({
      mobileNumber: phone,
      isDuplicate: existingMobiles.has(phone),
    }));

    return { extractedCount: uniquePhones.length, results };
  }

  async findDuplicates(companyId: string) {
    return this.prisma.$queryRaw`
      SELECT \`mobileNumber\`, count(*) as count 
      FROM leads 
      WHERE \`companyId\` = ${companyId} 
      GROUP BY \`mobileNumber\` 
      HAVING count(*) > 1
      LIMIT 200
    `;
  }

  async setBlacklist(id: string, isBlacklisted: boolean, companyId: string) {
    const result = await this.prisma.lead.updateMany({
      where: { id, companyId },
      data: { isBlacklisted, status: isBlacklisted ? LeadStatus.DND : LeadStatus.NEW },
    });
    if (result.count === 0) {
      throw new NotFoundException(`Lead with ID ${id} not found.`);
    }
    return this.prisma.lead.findFirst({ where: { id, companyId } });
  }

  async getImportHistory(companyId: string) {
    return this.prisma.importHistory.findMany({
      where: { companyId },
      take: clampListLimit(),
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true } } },
    });
  }
}
