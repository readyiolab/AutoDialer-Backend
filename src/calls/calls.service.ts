import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCallDto } from './dto/create-call.dto';
import { SubmitDispositionDto } from './dto/disposition.dto';
import { LeadStatus, CallDisposition, CallCategory } from '@prisma/client';
import { clampPage, clampPageSize, clampListLimit } from '../common/utils/pagination';

const DISPOSITION_ALIASES: Record<string, CallDisposition> = {
  NO_ANSWER: CallDisposition.NOT_PICKED,
  NOT_ANSWERED: CallDisposition.NOT_PICKED,
  CONVERTED: CallDisposition.CONVERTED,
  INVALID: CallDisposition.WRONG_NUMBER,
  INVALID_NUMBER: CallDisposition.WRONG_NUMBER,
  FOLLOW_UP: CallDisposition.FOLLOW_UP,
  FOLLOW_UP_REQUIRED: CallDisposition.FOLLOW_UP,
  EXCLUDED: CallDisposition.EXCLUDED,
  DO_NOT_CALL: CallDisposition.DND,
};

const CATEGORY_ALIASES: Record<string, CallCategory> = {
  NOT_CONNECTED: CallCategory.UNANSWERED,
  INVALID: CallCategory.OTHER,
  CONNECTED: CallCategory.CONNECTED,
  UNANSWERED: CallCategory.UNANSWERED,
  OTHER: CallCategory.OTHER,
};

@Injectable()
export class CallsService {
  constructor(private prisma: PrismaService) {}

  private normalizeDisposition(raw: string): CallDisposition {
    const key = String(raw || '').trim().toUpperCase();
    if ((Object.values(CallDisposition) as string[]).includes(key)) {
      return key as CallDisposition;
    }
    const mapped = DISPOSITION_ALIASES[key];
    if (mapped) return mapped;
    throw new BadRequestException(`Invalid disposition: ${raw}`);
  }

  private normalizeCategory(raw?: string): CallCategory {
    const key = String(raw || 'OTHER').trim().toUpperCase();
    return CATEGORY_ALIASES[key] || CallCategory.OTHER;
  }

  async recordCall(dto: CreateCallDto, userId: string, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, companyId },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    if (lead.assignedToId && lead.assignedToId !== userId) {
      throw new ForbiddenException('Lead is not assigned to you');
    }
    if (lead.isBlacklisted || lead.status === 'DND') {
      throw new BadRequestException('Cannot call blacklisted or DND lead');
    }

    const campaign = lead.campaignId
      ? await this.prisma.campaign.findFirst({ where: { id: lead.campaignId, companyId } })
      : null;
    const maxAttempts = campaign?.maxAttemptsPerLead || 10;
    const roundId = lead.currentRoundId || null;
    const membership = roundId
      ? await this.prisma.campaignRoundLead.findFirst({
          where: { roundId, leadId: lead.id },
          select: { roundAttemptCount: true },
        })
      : null;
    const roundAttempts = membership?.roundAttemptCount ?? lead.totalAttempts ?? 0;
    if (roundAttempts >= maxAttempts) {
      throw new BadRequestException('Maximum call attempts reached for this lead in the current round');
    }

    const attemptNumber = (lead.totalAttempts || 0) + 1;
    const roundAttemptNumber = roundAttempts + 1;

    return this.prisma.$transaction(async (tx) => {
      const callRecord = await tx.callRecord.create({
        data: {
          leadId: dto.leadId,
          userId,
          campaignId: dto.campaignId || lead.campaignId,
          roundId,
          companyId,
          startTime: new Date(dto.startTime),
          endTime: dto.endTime ? new Date(dto.endTime) : null,
          duration: dto.duration || 0,
          rawCallState: dto.rawCallState,
          attemptNumber: roundAttemptNumber,
        },
        include: {
          lead: { select: { customerName: true, mobileNumber: true } },
        },
      });

      await tx.lead.update({
        where: { id: dto.leadId },
        data: {
          totalAttempts: attemptNumber,
          lastContactedAt: new Date(dto.startTime),
        },
      });

      if (roundId) {
        await tx.campaignRoundLead.updateMany({
          where: { roundId, leadId: lead.id },
          data: { roundAttemptCount: roundAttemptNumber },
        });
      }

      return callRecord;
    });
  }

  async submitDisposition(
    callRecordId: string,
    dto: SubmitDispositionDto,
    userId: string,
    companyId: string,
  ) {
    const callRecord = await this.prisma.callRecord.findFirst({
      where: { id: callRecordId, companyId },
      include: { lead: true },
    });
    if (!callRecord) throw new NotFoundException('Call record not found');

    // Idempotent: already dispositioned — return as-is (avoid double follow-ups / status churn)
    if (callRecord.disposition) {
      return callRecord;
    }

    const disposition = this.normalizeDisposition(String(dto.disposition));
    const category = this.normalizeCategory(
      dto.category != null ? String(dto.category) : undefined,
    );

    let newStatus: LeadStatus = callRecord.lead.status;
    switch (disposition) {
      case CallDisposition.INTERESTED:
        newStatus = LeadStatus.INTERESTED;
        break;
      case CallDisposition.NOT_INTERESTED:
        newStatus = LeadStatus.NOT_INTERESTED;
        break;
      case CallDisposition.CALL_BACK:
        newStatus = LeadStatus.CALL_BACK;
        break;
      case CallDisposition.FOLLOW_UP:
        newStatus = LeadStatus.FOLLOW_UP_REQUIRED;
        break;
      case CallDisposition.CONVERTED:
        newStatus = LeadStatus.CONVERTED;
        break;
      case CallDisposition.EXCLUDED:
        newStatus = LeadStatus.EXCLUDED;
        break;
      case CallDisposition.DND:
        newStatus = LeadStatus.DND;
        break;
      case CallDisposition.APPLICATION_SUBMITTED:
        newStatus = LeadStatus.APPLICATION_SUBMITTED;
        break;
      case CallDisposition.DOCUMENTS_REQUIRED:
        newStatus = LeadStatus.DOCUMENTS_REQUIRED;
        break;
      case CallDisposition.PAYMENT_PROMISED:
        newStatus = LeadStatus.PAYMENT_PROMISED;
        break;
      case CallDisposition.BUSY:
        newStatus = LeadStatus.BUSY;
        break;
      case CallDisposition.SWITCHED_OFF:
        newStatus = LeadStatus.SWITCHED_OFF;
        break;
      case CallDisposition.NOT_PICKED:
      case CallDisposition.CALL_DECLINED:
      case CallDisposition.NETWORK_ERROR:
      case CallDisposition.FAILED:
        newStatus = LeadStatus.NO_ANSWER;
        break;
      case CallDisposition.NOT_REACHABLE:
        newStatus = LeadStatus.NOT_REACHABLE;
        break;
      case CallDisposition.WRONG_NUMBER:
      case CallDisposition.NUMBER_BELONGS_TO_SOMEONE_ELSE:
        newStatus = LeadStatus.INVALID_NUMBER;
        break;
      default:
        newStatus = LeadStatus.CONTACTED;
    }

    const roundId = callRecord.roundId || callRecord.lead.currentRoundId || null;

    const isConnected = category === CallCategory.CONNECTED;
    const previousStatus = callRecord.lead.status;

    return this.prisma.$transaction(async (tx) => {
      const updatedCall = await tx.callRecord.update({
        where: { id: callRecordId },
        data: {
          disposition,
          category,
          remarks: dto.remarks,
          followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null,
          followUpTime: dto.followUpTime,
          priority: dto.priority,
          voiceNoteUrl: dto.voiceNoteUrl,
          ...(roundId && !callRecord.roundId ? { roundId } : {}),
        },
      });

      await tx.lead.update({
        where: { id: callRecord.leadId },
        data: {
          status: newStatus,
          priority: dto.priority || callRecord.lead.priority,
          connectedCalls: isConnected ? { increment: 1 } : undefined,
          nextFollowUpAt: dto.followUpDate ? new Date(dto.followUpDate) : undefined,
        },
      });

      if (newStatus !== previousStatus) {
        await tx.leadStatusHistory.create({
          data: {
            leadId: callRecord.leadId,
            roundId,
            fromStatus: previousStatus,
            toStatus: newStatus,
            changedById: userId,
            remarks: dto.remarks || `Disposition: ${disposition}`,
            callId: callRecordId,
          },
        });
      }

      if (
        (disposition === CallDisposition.CALL_BACK ||
          disposition === CallDisposition.FOLLOW_UP) &&
        dto.followUpDate &&
        !(await tx.followUp.findFirst({ where: { callRecordId } }))
      ) {
        await tx.followUp.create({
          data: {
            leadId: callRecord.leadId,
            userId,
            campaignId: callRecord.campaignId || callRecord.lead?.campaignId || null,
            roundId,
            callRecordId,
            scheduledDate: new Date(dto.followUpDate),
            scheduledTime: dto.followUpTime,
            remarks: dto.remarks,
            companyId,
          },
        });
      }

      return updatedCall;
    });
  }

  async getHistory(params: {
    page?: number;
    pageSize?: number;
    userId?: string;
    campaignId?: string;
    disposition?: CallDisposition;
    dateFrom?: string;
    dateTo?: string;
    companyId: string;
  }) {
    const page = clampPage(params.page);
    const pageSize = clampPageSize(params.pageSize);
    const skip = (page - 1) * pageSize;
    const { userId, campaignId, disposition, dateFrom, dateTo, companyId } = params;

    const where: any = { companyId };
    if (userId) where.userId = userId;
    if (campaignId) where.campaignId = campaignId;
    if (disposition) where.disposition = disposition;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [total, data] = await Promise.all([
      this.prisma.callRecord.count({ where }),
      this.prisma.callRecord.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          lead: {
            select: {
              customerName: true,
              mobileNumber: true,
              city: true,
              loanAmount: true,
            },
          },
          user: { select: { name: true, employeeId: true } },
          campaign: { select: { name: true } },
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

  async getLiveActivity(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const limit = clampListLimit();

    const users = await this.prisma.user.findMany({
      where: { companyId, status: 'ACTIVE' },
      take: limit,
      select: {
        id: true,
        name: true,
        employeeId: true,
        dailyTarget: true,
      },
      orderBy: { name: 'asc' },
    });

    if (users.length === 0) {
      return [];
    }

    const userIds = users.map((u) => u.id);

    const [grouped, lastCalls] = await Promise.all([
      this.prisma.callRecord.groupBy({
        by: ['userId', 'category'],
        where: { companyId, userId: { in: userIds }, createdAt: { gte: today } },
        _count: { id: true },
      }),
      this.prisma.callRecord.findMany({
        where: { companyId, userId: { in: userIds }, createdAt: { gte: today } },
        orderBy: { createdAt: 'desc' },
        distinct: ['userId'],
        select: {
          userId: true,
          disposition: true,
          createdAt: true,
          lead: { select: { customerName: true } },
        },
      }),
    ]);

    const stats = new Map<string, { total: number; connected: number }>();
    for (const row of grouped) {
      const current = stats.get(row.userId) || { total: 0, connected: 0 };
      current.total += row._count.id;
      if (row.category === 'CONNECTED') {
        current.connected += row._count.id;
      }
      stats.set(row.userId, current);
    }

    const lastByUser = new Map(lastCalls.map((c) => [c.userId, c]));

    return users.map((u) => {
      const userStats = stats.get(u.id) || { total: 0, connected: 0 };
      const lastCall = lastByUser.get(u.id);
      return {
        userId: u.id,
        employeeId: u.employeeId,
        name: u.name,
        status:
          lastCall && Date.now() - new Date(lastCall.createdAt).getTime() < 300000
            ? 'Calling'
            : 'Available',
        callsToday: userStats.total,
        connectedToday: userStats.connected,
        target: u.dailyTarget,
        lastLead: lastCall ? lastCall.lead?.customerName : '-',
        lastDisposition: lastCall ? lastCall.disposition : '-',
        lastCallTime: lastCall ? lastCall.createdAt : null,
      };
    });
  }

  async getNextLeadInQueue(userId: string, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: {
        assignedToId: userId,
        companyId,
        isBlacklisted: false,
        status: { in: [LeadStatus.NEW, LeadStatus.CALL_BACK] },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      include: {
        campaign: { select: { name: true } },
        callRecords: {
          take: 3,
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true, disposition: true, duration: true },
        },
      },
    });

    const pendingCount = await this.prisma.lead.count({
      where: {
        assignedToId: userId,
        companyId,
        status: { in: [LeadStatus.NEW, LeadStatus.CALL_BACK] },
      },
    });

    return {
      lead,
      pendingCount,
    };
  }
}
