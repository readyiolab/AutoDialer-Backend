import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DialerService } from '../dialer/dialer.service';
import { CallsService } from '../calls/calls.service';
import { LeadsService } from '../leads/leads.service';
import { FollowUpsService } from '../followups/followups.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { DevicesService, DeviceMeta } from '../devices/devices.service';
import { CommunicationService } from '../communication/communication.service';
import { LoginDto } from '../auth/dto/login.dto';
import { DialMode } from '@prisma/client';
import { clampPage, clampPageSize } from '../common/utils/pagination';

@Injectable()
export class MobileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly dialer: DialerService,
    private readonly calls: CallsService,
    private readonly leads: LeadsService,
    private readonly followUpsService: FollowUpsService,
    private readonly notificationsService: NotificationsService,
    private readonly users: UsersService,
    private readonly devices: DevicesService,
    private readonly communication: CommunicationService,
  ) {}

  async login(dto: LoginDto) {
    return this.auth.login({ ...dto, clientType: 'android' }, 'android');
  }

  async me(userId: string) {
    return this.auth.getProfile(userId);
  }

  async dashboard(userId: string, companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dialable = [
      'NEW',
      'ASSIGNED',
      'PENDING',
      'NOT_CONTACTED',
      'CALL_BACK',
      'FOLLOW_UP_REQUIRED',
      'BUSY',
      'NO_ANSWER',
      'SWITCHED_OFF',
    ];

    const [
      totalAssigned,
      pendingLeads,
      callsToday,
      connectedToday,
      interestedLeads,
      convertedLeads,
      followUpsDue,
      overdueFollowUps,
      newLeads,
      remainingLeads,
      user,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { companyId, assignedToId: userId } }),
      this.prisma.lead.count({
        where: { companyId, assignedToId: userId, status: { in: dialable as any } },
      }),
      this.prisma.callRecord.count({
        where: { companyId, userId, createdAt: { gte: today } },
      }),
      this.prisma.callRecord.count({
        where: { companyId, userId, category: 'CONNECTED', createdAt: { gte: today } },
      }),
      this.prisma.lead.count({
        where: { companyId, assignedToId: userId, status: 'INTERESTED' },
      }),
      this.prisma.lead.count({
        where: { companyId, assignedToId: userId, status: 'CONVERTED' },
      }),
      this.prisma.followUp.count({
        where: {
          companyId,
          userId,
          status: { in: ['PENDING', 'OVERDUE'] },
          scheduledDate: { gte: today, lt: new Date(today.getTime() + 86400000) },
        },
      }),
      this.prisma.followUp.count({
        where: {
          companyId,
          userId,
          OR: [
            { status: 'OVERDUE' },
            { status: 'PENDING', scheduledDate: { lt: today } },
          ],
        },
      }),
      this.prisma.lead.count({
        where: {
          companyId,
          assignedToId: userId,
          status: { in: ['NEW', 'ASSIGNED'] },
          totalAttempts: 0,
        },
      }),
      this.prisma.lead.count({
        where: {
          companyId,
          assignedToId: userId,
          status: { in: dialable as any },
          isBlacklisted: false,
        },
      }),
      this.prisma.user.findFirst({
        where: { id: userId, companyId },
        select: { dailyTarget: true, name: true, status: true },
      }),
    ]);

    const activeSession = await this.prisma.dialSession.findFirst({
      where: { userId, companyId, status: { in: ['RUNNING', 'PAUSED'] } },
      orderBy: { startedAt: 'desc' },
    });

    return {
      totalAssigned,
      pendingLeads,
      callsCompletedToday: callsToday,
      connectedCalls: connectedToday,
      interestedLeads,
      convertedLeads,
      followUpsDue,
      overdueFollowUps,
      newLeads,
      remainingLeads,
      dailyTarget: user?.dailyTarget || 100,
      workingStatus: activeSession?.status || 'OFFLINE',
      activeSessionId: activeSession?.id || null,
    };
  }

  async listLeads(userId: string, companyId: string, query: any) {
    return this.leads.findAll({
      ...query,
      companyId,
      assignedToId: userId,
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      status: query.status,
      campaignId: query.campaignId,
    });
  }

  async getLead(id: string, userId: string, companyId: string) {
    const lead = await this.leads.findOne(id, companyId);
    if (lead.assignedToId !== userId) {
      throw new ForbiddenException('Lead is not assigned to you');
    }
    return lead;
  }

  async startSession(
    userId: string,
    companyId: string,
    body: { campaignId?: string; mode?: DialMode; forceNew?: boolean },
  ) {
    return this.dialer.startSession(userId, companyId, body || {});
  }

  async getActiveSession(userId: string, companyId: string, campaignId?: string) {
    return this.dialer.getActiveSession(userId, companyId, campaignId);
  }

  async listActiveSessions(userId: string, companyId: string) {
    return this.dialer.listActiveSessions(userId, companyId);
  }

  async dialerEvent(
    sessionId: string,
    userId: string,
    companyId: string,
    body: any,
  ) {
    return this.dialer.handleEvent(sessionId, userId, companyId, body);
  }

  async pauseSession(sessionId: string, userId: string, companyId: string) {
    return this.dialer.pauseSession(sessionId, userId, companyId);
  }

  async resumeSession(sessionId: string, userId: string, companyId: string) {
    return this.dialer.resumeSession(sessionId, userId, companyId);
  }

  async endSession(sessionId: string, userId: string, companyId: string) {
    return this.dialer.endSession(sessionId, userId, companyId);
  }

  async nextLead(sessionId: string, userId: string, companyId: string) {
    return this.dialer.getNext(sessionId, userId, companyId);
  }

  async submitDisposition(
    callId: string,
    userId: string,
    companyId: string,
    dto: any,
  ) {
    return this.calls.submitDisposition(callId, dto, userId, companyId);
  }

  async followUps(userId: string, companyId: string, type?: string) {
    const rows = await this.followUpsService.findAll({
      companyId,
      userId,
      type: (type as any) || 'pending',
    });
    // Flatten nested lead fields for Android clients that read top-level keys
    return rows.map((f: any) => ({
      ...f,
      customerName: f.lead?.customerName,
      mobileNumber: f.lead?.mobileNumber,
      followUpDate: f.scheduledDate,
      leadId: f.leadId || f.lead?.id,
      roundId: f.roundId,
    }));
  }

  async completeFollowUp(id: string, userId: string, companyId: string, remarks?: string) {
    const existing = await this.prisma.followUp.findFirst({
      where: { id, companyId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Follow-up not found');
    }
    return this.followUpsService.markComplete(id, remarks || '', companyId);
  }

  async rescheduleFollowUp(
    id: string,
    userId: string,
    companyId: string,
    body: { scheduledDate: string; scheduledTime?: string; remarks?: string },
  ) {
    const existing = await this.prisma.followUp.findFirst({
      where: { id, companyId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Follow-up not found');
    }
    return this.followUpsService.reschedule(id, companyId, body);
  }

  async performance(userId: string, companyId: string, dateFrom?: string, dateTo?: string) {
    return this.users.getPerformanceStats(userId, companyId, dateFrom, dateTo);
  }

  async notifications(userId: string, companyId: string, page?: number, pageSize?: number) {
    return this.notificationsService.listForUser(userId, companyId, page, pageSize);
  }

  async markNotificationRead(id: string, userId: string) {
    return this.notificationsService.markRead(id, userId);
  }

  async registerDevice(userId: string, companyId: string, body: DeviceMeta) {
    await this.devices.registerOrUpdateSelf(userId, companyId, body);
    return { success: true };
  }

  async reportScreenshot(userId: string, companyId: string, deviceId?: string) {
    return this.devices.logScreenshotAttempt(userId, companyId, deviceId);
  }

  async syncBatch(
    userId: string,
    companyId: string,
    events: Array<{
      idempotencyKey: string;
      type: string;
      payload: any;
    }>,
  ) {
    if (!Array.isArray(events) || events.length > 100) {
      throw new BadRequestException('events must be an array of at most 100 items');
    }

    const results: any[] = [];
    for (const event of events) {
      if (!event.idempotencyKey || !event.type) {
        results.push({ ok: false, error: 'Missing idempotencyKey or type' });
        continue;
      }

      const existing = await this.prisma.auditLog.findFirst({
        where: {
          companyId,
          userId,
          action: 'MOBILE_SYNC',
          entityId: event.idempotencyKey,
        },
      });
      if (existing) {
        results.push({ ok: true, duplicate: true, idempotencyKey: event.idempotencyKey });
        continue;
      }

      try {
        let outcome: any = { ok: true };
        switch (event.type) {
          case 'dialer_event':
            outcome = await this.dialer.handleEvent(
              event.payload.sessionId,
              userId,
              companyId,
              event.payload,
            );
            break;
          case 'disposition':
            outcome = await this.calls.submitDisposition(
              event.payload.callId,
              event.payload,
              userId,
              companyId,
            );
            break;
          case 'lead_note': {
            const lead = await this.getLead(event.payload.leadId, userId, companyId);
            outcome = await this.leads.update(
              lead.id,
              (event.payload.update || {}) as any,
              companyId,
              userId,
            );
            break;
          }
          default:
            throw new BadRequestException(`Unknown sync type ${event.type}`);
        }

        await this.prisma.auditLog.create({
          data: {
            userId,
            companyId,
            action: 'MOBILE_SYNC',
            entity: event.type,
            entityId: event.idempotencyKey,
            newValues: { type: event.type },
          },
        });
        results.push({ ok: true, idempotencyKey: event.idempotencyKey, outcome });
      } catch (err: any) {
        results.push({
          ok: false,
          idempotencyKey: event.idempotencyKey,
          error: err.message || 'sync failed',
        });
      }
    }

    return { results };
  }

  async callHistory(userId: string, companyId: string, query: any) {
    return this.calls.getHistory({
      ...query,
      companyId,
      userId,
      page: clampPage(query.page),
      pageSize: clampPageSize(query.pageSize),
    });
  }

  async getShareLink(userId: string, companyId: string, leadId?: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: { shareLink: true, name: true },
    });
    if (!user) throw new NotFoundException('User not found');

    let leadName = 'there';
    let customerName: string | null = null;
    let mobileNumber: string | null = null;
    let campaignName: string | null = null;
    if (leadId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, companyId, assignedToId: userId },
        select: {
          customerName: true,
          mobileNumber: true,
          campaign: { select: { name: true } },
        },
      });
      if (lead) {
        customerName = lead.customerName;
        leadName = lead.customerName?.split(' ')[0] || 'there';
        mobileNumber = lead.mobileNumber;
        campaignName = lead.campaign?.name || null;
      }
    }

    const shareLink = user.shareLink?.trim() || null;
    const { templates, preferredTemplateId } =
      await this.communication.getShareTemplates({
        companyId,
        shareLink,
        customerName: customerName || leadName,
        campaignName,
        type: 'WHATSAPP' as any,
      });

    const preferred =
      templates.find((t) => t.id === preferredTemplateId) || templates[0];
    const defaultMessage =
      preferred?.content ||
      (shareLink
        ? `Hi ${leadName}, thanks for your interest! Here is your link: ${shareLink}`
        : `Hi ${leadName}, thanks for your interest! Our team will share the details shortly.`);

    return {
      shareLink,
      defaultMessage,
      mobileNumber,
      configured: Boolean(shareLink),
      preferredTemplateId: preferred?.id || null,
      templates,
    };
  }

  async logShare(
    userId: string,
    companyId: string,
    body: {
      leadId: string;
      type: 'WHATSAPP' | 'SMS';
      content: string;
      templateId?: string;
    },
  ) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: body.leadId, companyId, assignedToId: userId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    let templateId: string | null = body.templateId?.trim() || null;
    if (templateId) {
      const template = await this.prisma.messageTemplate.findFirst({
        where: { id: templateId, companyId },
        select: { id: true },
      });
      if (!template) templateId = null;
    }

    const log = await this.prisma.communicationLog.create({
      data: {
        leadId: body.leadId,
        userId,
        companyId,
        type: body.type,
        content: body.content,
        templateId,
        status: 'SENT',
        sentAt: new Date(),
      },
    });

    return { success: true, id: log.id };
  }

  private readonly dialableStatuses = [
    'NEW',
    'ASSIGNED',
    'PENDING',
    'NOT_CONTACTED',
    'CALL_BACK',
    'FOLLOW_UP_REQUIRED',
    'BUSY',
    'NO_ANSWER',
    'SWITCHED_OFF',
    'NOT_REACHABLE',
  ];

  private async campaignProgress(userId: string, companyId: string, campaignId: string) {
    const activeRound = await this.prisma.campaignRound.findFirst({
      where: { campaignId, companyId, status: 'ACTIVE' },
      orderBy: { roundNumber: 'desc' },
      select: { id: true, roundNumber: true },
    });

    const callWhere: any = { companyId, userId, campaignId };
    if (activeRound) callWhere.roundId = activeRound.id;

    const [connectedCalls, talkAgg, unanswered] = await Promise.all([
      this.prisma.callRecord.count({
        where: { ...callWhere, category: 'CONNECTED' },
      }),
      this.prisma.callRecord.aggregate({
        where: callWhere,
        _sum: { duration: true },
        _avg: { duration: true },
        _count: true,
      }),
      this.prisma.lead.count({
        where: {
          companyId,
          assignedToId: userId,
          campaignId,
          isBlacklisted: false,
          status: { in: ['NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'NOT_REACHABLE'] as any },
          ...(activeRound ? { currentRoundId: activeRound.id } : {}),
        },
      }),
    ]);

    let total: number;
    let called: number;
    if (activeRound) {
      const [membershipTotal, membershipCalled] = await Promise.all([
        this.prisma.campaignRoundLead.count({
          where: { roundId: activeRound.id, assignedToId: userId },
        }),
        this.prisma.campaignRoundLead.count({
          where: {
            roundId: activeRound.id,
            assignedToId: userId,
            roundAttemptCount: { gt: 0 },
          },
        }),
      ]);
      total = membershipTotal;
      called = membershipCalled;
    } else {
      const base = { companyId, assignedToId: userId, campaignId, isBlacklisted: false };
      const [t, attempted] = await Promise.all([
        this.prisma.lead.count({ where: base }),
        this.prisma.lead.count({ where: { ...base, totalAttempts: { gt: 0 } } }),
      ]);
      total = t;
      called = attempted;
    }

    const remaining = Math.max(0, total - called);
    const percent = total > 0 ? Math.round((called / total) * 100) : 0;
    const callsMade = talkAgg._count || 0;
    const connectionRate = callsMade > 0 ? Math.round((connectedCalls / callsMade) * 100) : 0;
    return {
      total,
      called,
      pending: remaining,
      connected: connectedCalls,
      unanswered,
      talkSeconds: talkAgg._sum.duration || 0,
      avgDurationSec: Math.round(talkAgg._avg.duration || 0),
      callsMade,
      connectionRate,
      percent,
      status: remaining === 0 && total > 0 ? 'COMPLETED' : 'ACTIVE',
      currentRoundNumber: activeRound?.roundNumber ?? null,
    };
  }

  async todayHome(userId: string, companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7 * 86400000);

    const [
      totalAssigned,
      pendingLeads,
      callsToday,
      connectedToday,
      interestedLeads,
      convertedLeads,
      followUpsDue,
      overdueFollowUps,
      newLeads,
      remainingLeads,
      user,
      activeSession,
      inboxCount,
      notesCount,
      topCampaign,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { companyId, assignedToId: userId } }),
      this.prisma.lead.count({
        where: { companyId, assignedToId: userId, status: { in: this.dialableStatuses as any } },
      }),
      this.prisma.callRecord.count({
        where: { companyId, userId, createdAt: { gte: today } },
      }),
      this.prisma.callRecord.count({
        where: { companyId, userId, category: 'CONNECTED', createdAt: { gte: today } },
      }),
      this.prisma.lead.count({
        where: { companyId, assignedToId: userId, status: 'INTERESTED' },
      }),
      this.prisma.lead.count({
        where: { companyId, assignedToId: userId, status: 'CONVERTED' },
      }),
      this.prisma.followUp.count({
        where: {
          companyId,
          userId,
          status: { in: ['PENDING', 'OVERDUE'] },
          scheduledDate: { gte: today, lt: new Date(today.getTime() + 86400000) },
        },
      }),
      this.prisma.followUp.count({
        where: {
          companyId,
          userId,
          OR: [
            { status: 'OVERDUE' },
            { status: 'PENDING', scheduledDate: { lt: today } },
          ],
        },
      }),
      this.prisma.lead.count({
        where: {
          companyId,
          assignedToId: userId,
          status: { in: ['NEW', 'ASSIGNED'] },
          totalAttempts: 0,
        },
      }),
      this.prisma.lead.count({
        where: {
          companyId,
          assignedToId: userId,
          status: { in: this.dialableStatuses as any },
          isBlacklisted: false,
        },
      }),
      this.prisma.user.findFirst({
        where: { id: userId, companyId },
        select: { dailyTarget: true, name: true, status: true },
      }),
      this.prisma.dialSession.findFirst({
        where: { userId, companyId, status: { in: ['RUNNING', 'PAUSED'] } },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.lead.count({
        where: {
          companyId,
          assignedToId: userId,
          isBlacklisted: false,
          OR: [
            { totalAttempts: 0, lastContactedAt: null },
            { needsReview: true },
            { status: { in: ['NO_ANSWER', 'BUSY', 'SWITCHED_OFF'] as any }, connectedCalls: 0 },
          ],
        },
      }),
      this.prisma.callRecord.count({
        where: {
          companyId,
          userId,
          remarks: { not: null },
          createdAt: { gte: weekAgo },
        },
      }),
      this.prisma.lead.groupBy({
        by: ['campaignId'],
        where: {
          companyId,
          assignedToId: userId,
          campaignId: { not: null },
          status: { in: this.dialableStatuses as any },
          isBlacklisted: false,
        },
        _count: { _all: true },
        orderBy: { _count: { campaignId: 'desc' } },
        take: 1,
      }),
    ]);

    let activeList: any = null;
    let campaignId = activeSession?.campaignId || topCampaign[0]?.campaignId || null;

    if (campaignId) {
      const campaign = await this.prisma.campaign.findFirst({
        where: { id: campaignId, companyId },
        select: { id: true, name: true, createdAt: true },
      });
      if (campaign) {
        const progress = await this.campaignProgress(userId, companyId, campaign.id);
        activeList = {
          id: campaign.id,
          name: campaign.name,
          ...progress,
          sessionStatus: activeSession?.status || null,
          sessionId: activeSession?.id || null,
        };
      }
    }

    return {
      totalAssigned,
      pendingLeads,
      callsCompletedToday: callsToday,
      connectedCalls: connectedToday,
      interestedLeads,
      convertedLeads,
      followUpsDue,
      overdueFollowUps,
      newLeads,
      remainingLeads,
      dailyTarget: user?.dailyTarget || 100,
      workingStatus: activeSession?.status || 'OFFLINE',
      activeSessionId: activeSession?.id || null,
      activeList,
      inboxCount,
      notesCount,
    };
  }

  /** Batch campaign progress for many campaigns (avoids N× campaignProgress). */
  private async campaignProgressBatch(
    userId: string,
    companyId: string,
    campaignIds: string[],
  ): Promise<Map<string, Awaited<ReturnType<MobileService['campaignProgress']>>>> {
    const result = new Map<string, Awaited<ReturnType<MobileService['campaignProgress']>>>();
    if (!campaignIds.length) return result;

    const leadBase = {
      companyId,
      assignedToId: userId,
      campaignId: { in: campaignIds },
      isBlacklisted: false,
    };

    const [totals, attempted, unanswered, callStats, connected] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['campaignId'],
        where: leadBase,
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['campaignId'],
        where: { ...leadBase, totalAttempts: { gt: 0 } },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['campaignId'],
        where: {
          ...leadBase,
          status: { in: ['NO_ANSWER', 'BUSY', 'SWITCHED_OFF'] as any },
        },
        _count: { _all: true },
      }),
      this.prisma.callRecord.groupBy({
        by: ['campaignId'],
        where: { companyId, userId, campaignId: { in: campaignIds } },
        _count: { _all: true },
        _sum: { duration: true },
        _avg: { duration: true },
      }),
      this.prisma.callRecord.groupBy({
        by: ['campaignId'],
        where: {
          companyId,
          userId,
          campaignId: { in: campaignIds },
          category: 'CONNECTED',
        },
        _count: { _all: true },
      }),
    ]);

    const toMap = (rows: { campaignId: string | null; _count: { _all: number } }[]) =>
      new Map(rows.filter((r) => r.campaignId).map((r) => [r.campaignId!, r._count._all]));

    const totalMap = toMap(totals);
    const attemptedMap = toMap(attempted);
    const unansweredMap = toMap(unanswered);
    const connectedMap = toMap(connected);
    const talkMap = new Map(
      callStats
        .filter((r) => r.campaignId)
        .map((r) => [
          r.campaignId!,
          {
            callsMade: r._count._all,
            talkSeconds: r._sum.duration || 0,
            avgDurationSec: Math.round(r._avg.duration || 0),
          },
        ]),
    );

    for (const id of campaignIds) {
      const total = totalMap.get(id) || 0;
      const called = attemptedMap.get(id) || 0;
      const remaining = Math.max(0, total - called);
      const connectedCalls = connectedMap.get(id) || 0;
      const talk = talkMap.get(id) || { callsMade: 0, talkSeconds: 0, avgDurationSec: 0 };
      const connectionRate =
        talk.callsMade > 0 ? Math.round((connectedCalls / talk.callsMade) * 100) : 0;
      const percent = total > 0 ? Math.round((called / total) * 100) : 0;
      result.set(id, {
        total,
        called,
        pending: remaining,
        connected: connectedCalls,
        unanswered: unansweredMap.get(id) || 0,
        talkSeconds: talk.talkSeconds,
        avgDurationSec: talk.avgDurationSec,
        callsMade: talk.callsMade,
        connectionRate,
        percent,
        status: remaining === 0 && total > 0 ? 'COMPLETED' : 'ACTIVE',
        currentRoundNumber: null,
      });
    }

    return result;
  }

  async listCampaigns(userId: string, companyId: string) {
    const grouped = await this.prisma.lead.groupBy({
      by: ['campaignId'],
      where: { companyId, assignedToId: userId, campaignId: { not: null } },
      _count: { _all: true },
    });
    const ids = grouped.map((g) => g.campaignId!).filter(Boolean);
    if (!ids.length) return { data: [], total: 0 };

    const [campaigns, progressMap] = await Promise.all([
      this.prisma.campaign.findMany({
        where: { id: { in: ids }, companyId },
        orderBy: { updatedAt: 'desc' },
      }),
      this.campaignProgressBatch(userId, companyId, ids),
    ]);

    const data = campaigns.map((c) => {
      const progress = progressMap.get(c.id) || {
        total: 0,
        called: 0,
        pending: 0,
        connected: 0,
        unanswered: 0,
        talkSeconds: 0,
        avgDurationSec: 0,
        callsMade: 0,
        connectionRate: 0,
        percent: 0,
        status: 'ACTIVE',
      };
      return {
        id: c.id,
        name: c.name,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        ...progress,
      };
    });

    return { data, total: data.length };
  }

  async listCampaignDetail(
    campaignId: string,
    userId: string,
    companyId: string,
    query: { statusFilter?: string; page?: number; pageSize?: number; tab?: string },
  ) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, companyId },
    });
    if (!campaign) throw new NotFoundException('List not found');

    const progress = await this.campaignProgress(userId, companyId, campaignId);
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize || 50);
    const filter = (query.statusFilter || 'all').toLowerCase();

    const where: any = {
      companyId,
      assignedToId: userId,
      campaignId,
      isBlacklisted: false,
    };
    if (filter === 'pending') {
      where.OR = [{ totalAttempts: 0 }, { lastContactedAt: null }];
      where.status = { in: this.dialableStatuses };
    } else if (filter === 'attempted') {
      where.totalAttempts = { gt: 0 };
    }

    const [members, totalMembers] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          customerName: true,
          mobileNumber: true,
          status: true,
          totalAttempts: true,
          connectedCalls: true,
          lastContactedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.lead.count({ where }),
    ]);

    const outcomeGroups = await this.prisma.callRecord.groupBy({
      by: ['disposition'],
      where: { companyId, userId, campaignId, disposition: { not: null } },
      _count: { _all: true },
    });

    const insights = {
      connectionRate: progress.connectionRate,
      avgDurationSec: progress.avgDurationSec,
      callsMade: progress.callsMade,
      attempted: progress.called,
      pending: progress.pending,
      skipped: 0,
      outcomes: outcomeGroups.map((o) => ({
        disposition: o.disposition,
        count: o._count._all,
      })),
    };

    return {
      list: {
        id: campaign.id,
        name: campaign.name,
        createdAt: campaign.createdAt,
        ...progress,
      },
      members,
      pagination: { total: totalMembers, page, pageSize, filter },
      insights,
    };
  }

  async inboxLeads(userId: string, companyId: string, query: any) {
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize || 50);
    const where: any = {
      companyId,
      assignedToId: userId,
      isBlacklisted: false,
      OR: [
        { totalAttempts: 0, lastContactedAt: null },
        { needsReview: true },
        {
          status: { in: ['NO_ANSWER', 'BUSY', 'SWITCHED_OFF'] as any },
          connectedCalls: 0,
          totalAttempts: { gte: 1 },
        },
      ],
    };
    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { campaign: { select: { id: true, name: true } } },
      }),
      this.prisma.lead.count({ where }),
    ]);
    // Keep shape without top-level meta so TransformInterceptor does not unwrap
    return { items: data, pagination: { total, page, pageSize } };
  }
}

