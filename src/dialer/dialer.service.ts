import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DialMode, LeadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CallsService } from '../calls/calls.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';

const DIALABLE_STATUSES: LeadStatus[] = [
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

@Injectable()
export class DialerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly callsService: CallsService,
    private readonly realtime: RealtimeGateway,
    private readonly audit: AuditService,
  ) {}

  async startSession(
    userId: string,
    companyId: string,
    opts: { campaignId?: string; mode?: DialMode; forceNew?: boolean } = {},
  ) {
    const mode = opts.mode || 'PROGRESSIVE';
    if (mode === 'PREDICTIVE') {
      throw new BadRequestException(
        'Predictive dialing requires a telephony provider and is not available',
      );
    }

    const campaignId = opts.campaignId?.trim();
    if (!campaignId) {
      throw new BadRequestException('campaignId is required to start a dialer session');
    }
    await this.assertCampaignAssignment(userId, companyId, campaignId);

    const forceNew = !!opts.forceNew;
    if (!forceNew) {
      const existing = await this.prisma.dialSession.findFirst({
        where: {
          userId,
          companyId,
          campaignId,
          status: { in: ['RUNNING', 'PAUSED'] },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (existing) {
        return this.buildSessionPayload(existing, userId, companyId);
      }
    }

    await this.prisma.dialSession.updateMany({
      where: {
        userId,
        companyId,
        campaignId,
        status: { in: ['RUNNING', 'PAUSED'] },
      },
      data: { status: 'ENDED', endedAt: new Date(), currentLeadId: null },
    });

    const session = await this.prisma.dialSession.create({
      data: {
        userId,
        companyId,
        campaignId,
        mode,
        status: 'RUNNING',
        completedCount: 0,
      },
    });

    const next = await this.pickNextLead(userId, companyId, campaignId, session.id);
    this.realtime.emitToCompany(companyId, 'dialer:presence', {
      userId,
      status: 'RUNNING',
      sessionId: session.id,
      leadId: next.lead?.id,
    });

    return {
      session,
      lead: next.lead,
      pendingCount: next.pendingCount,
      completedCount: session.completedCount,
      tel: next.lead ? `tel:${next.lead.mobileNumber}` : null,
      reason: next.lead ? undefined : next.reason,
      reattached: false,
    };
  }

  async getActiveSession(userId: string, companyId: string, campaignId?: string) {
    const where: any = {
      userId,
      companyId,
      status: { in: ['RUNNING', 'PAUSED'] },
    };
    if (campaignId) where.campaignId = campaignId;

    const session = await this.prisma.dialSession.findFirst({
      where,
      orderBy: { updatedAt: 'desc' },
    });
    if (!session) {
      return {
        session: null,
        lead: null,
        pendingCount: 0,
        completedCount: 0,
        tel: null,
        reason: 'no_active_session',
      };
    }
    return this.buildSessionPayload(session, userId, companyId);
  }

  async listActiveSessions(userId: string, companyId: string) {
    const sessions = await this.prisma.dialSession.findMany({
      where: { userId, companyId, status: { in: ['RUNNING', 'PAUSED'] } },
      orderBy: { updatedAt: 'desc' },
      include: {
        campaign: { select: { id: true, name: true, status: true } },
      },
    });

    const payloads = await Promise.all(
      sessions.map(async (session) => {
        const payload = await this.buildSessionPayload(session, userId, companyId);
        return {
          ...payload,
          campaign: (session as any).campaign || null,
        };
      }),
    );

    return { sessions: payloads, total: payloads.length };
  }

  private async assertCampaignAssignment(
    userId: string,
    companyId: string,
    campaignId: string,
  ) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, companyId },
      select: { id: true, status: true },
    });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const assignment = await this.prisma.campaignAssignment.findFirst({
      where: {
        campaignId,
        userId,
        user: { id: userId, companyId, status: 'ACTIVE' },
      },
    });
    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this campaign');
    }
    return campaign;
  }

  async pauseSession(sessionId: string, userId: string, companyId: string) {
    const session = await this.getOwnedSession(sessionId, userId, companyId);
    if (session.status === 'ENDED') {
      throw new BadRequestException('Session has ended');
    }
    if (session.status === 'PAUSED') {
      return session;
    }
    if (session.status !== 'RUNNING') {
      throw new BadRequestException('Only a running session can be paused');
    }
    const updated = await this.prisma.dialSession.update({
      where: { id: session.id },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    this.realtime.emitToCompany(companyId, 'dialer:presence', {
      userId,
      status: 'PAUSED',
      sessionId,
    });
    return updated;
  }

  async resumeSession(sessionId: string, userId: string, companyId: string) {
    const session = await this.getOwnedSession(sessionId, userId, companyId);
    if (session.status === 'ENDED') {
      throw new BadRequestException('Session has ended — start a new session');
    }
    if (session.status !== 'PAUSED' && session.status !== 'RUNNING') {
      throw new BadRequestException('Session cannot be resumed');
    }

    const updated =
      session.status === 'PAUSED'
        ? await this.prisma.dialSession.update({
            where: { id: session.id },
            data: { status: 'RUNNING', pausedAt: null },
          })
        : session;

    // Prefer unfinished current lead (open call or still dialable) before picking next
    if (session.currentLeadId) {
      const current = await this.prisma.lead.findFirst({
        where: {
          id: session.currentLeadId,
          companyId,
          assignedToId: userId,
          isBlacklisted: false,
          status: { in: DIALABLE_STATUSES },
        },
        include: {
          campaign: { select: { id: true, name: true, maxAttemptsPerLead: true } },
        },
      });
      const openCall = current
        ? await this.prisma.callRecord.findFirst({
            where: {
              leadId: current.id,
              userId,
              companyId,
              dialSessionId: sessionId,
              OR: [{ endTime: null }, { disposition: null }],
            },
            orderBy: { createdAt: 'desc' },
          })
        : null;

      if (current && (openCall || DIALABLE_STATUSES.includes(current.status))) {
        await this.prisma.dialSession.update({
          where: { id: sessionId },
          data: { currentLeadId: current.id },
        });
        const pendingCount = await this.countPending(
          userId,
          companyId,
          session.campaignId || undefined,
        );
        this.realtime.emitToCompany(companyId, 'dialer:presence', {
          userId,
          status: 'RUNNING',
          sessionId,
          leadId: current.id,
        });
        return {
          session: updated,
          lead: current,
          pendingCount,
          completedCount: updated.completedCount,
          tel: `tel:${current.mobileNumber}`,
          awaitingDisposition: !!openCall && (!openCall.endTime || !openCall.disposition),
        };
      }
    }

    const next = await this.pickNextLead(
      userId,
      companyId,
      session.campaignId || undefined,
      session.id,
    );
    this.realtime.emitToCompany(companyId, 'dialer:presence', {
      userId,
      status: 'RUNNING',
      sessionId,
      leadId: next.lead?.id,
    });
    return {
      session: updated,
      lead: next.lead,
      pendingCount: next.pendingCount,
      completedCount: updated.completedCount,
      tel: next.lead ? `tel:${next.lead.mobileNumber}` : null,
      reason: next.lead ? undefined : next.reason,
      awaitingDisposition: false,
    };
  }

  async endSession(sessionId: string, userId: string, companyId: string) {
    const session = await this.getOwnedSession(sessionId, userId, companyId);
    if (session.status === 'ENDED') {
      return session;
    }
    if (session.status !== 'RUNNING' && session.status !== 'PAUSED') {
      throw new BadRequestException('Session cannot be ended');
    }
    const updated = await this.prisma.dialSession.update({
      where: { id: sessionId },
      data: { status: 'ENDED', endedAt: new Date(), currentLeadId: null, pausedAt: null },
    });
    this.realtime.emitToCompany(companyId, 'dialer:presence', {
      userId,
      status: 'OFFLINE',
      sessionId,
    });
    return updated;
  }

  async handleEvent(
    sessionId: string,
    userId: string,
    companyId: string,
    event: {
      type: 'started' | 'ended' | 'skip';
      leadId?: string;
      duration?: number;
      disposition?: string;
      category?: string;
      remarks?: string;
      followUpDate?: string;
      followUpTime?: string;
      idempotencyKey?: string;
    },
  ) {
    const session = await this.getOwnedSession(sessionId, userId, companyId);
    if (session.status === 'ENDED') {
      throw new BadRequestException('Session has ended');
    }
    if (session.status === 'PAUSED' && event.type !== 'ended') {
      throw new BadRequestException('Session is paused');
    }

    if (event.idempotencyKey) {
      const prior = await this.prisma.dialSessionEvent.findUnique({
        where: {
          sessionId_idempotencyKey: {
            sessionId,
            idempotencyKey: event.idempotencyKey,
          },
        },
      });
      if (prior?.responseJson) {
        return prior.responseJson as any;
      }
    }

    let result: any;
    if (event.type === 'started') {
      result = await this.handleStarted(session, userId, companyId, event);
    } else if (event.type === 'skip') {
      result = await this.handleSkip(session, userId, companyId, event);
    } else {
      result = await this.handleEnded(session, userId, companyId, event);
    }

    if (event.idempotencyKey) {
      await this.prisma.dialSessionEvent.upsert({
        where: {
          sessionId_idempotencyKey: {
            sessionId,
            idempotencyKey: event.idempotencyKey,
          },
        },
        create: {
          sessionId,
          idempotencyKey: event.idempotencyKey,
          eventType: event.type,
          responseJson: result,
        },
        update: { responseJson: result },
      });
    }

    return result;
  }

  private async handleStarted(
    session: any,
    userId: string,
    companyId: string,
    event: { leadId?: string },
  ) {
    const leadId = event.leadId || session.currentLeadId;
    if (!leadId) throw new BadRequestException('No lead to dial');
    const lead = await this.assertAssignableLead(leadId, userId, companyId);
    await this.prisma.dialSession.update({
      where: { id: session.id },
      data: { currentLeadId: lead.id },
    });
    const call = await this.callsService.recordCall(
      {
        leadId: lead.id,
        campaignId: session.campaignId || lead.campaignId || undefined,
        startTime: new Date().toISOString(),
        rawCallState: 'DIALING',
      } as any,
      userId,
      companyId,
    );
    await this.prisma.callRecord.update({
      where: { id: call.id },
      data: { dialSessionId: session.id },
    });
    this.realtime.emitToCompany(companyId, 'dialer:presence', {
      userId,
      status: 'ON_CALL',
      sessionId: session.id,
      leadId: lead.id,
    });
    return { call: { ...call, dialSessionId: session.id }, lead, tel: `tel:${lead.mobileNumber}` };
  }

  private async handleSkip(
    session: any,
    userId: string,
    companyId: string,
    event: { leadId?: string },
  ) {
    const leadId = event.leadId || session.currentLeadId;
    if (leadId) {
      await this.prisma.lead.updateMany({
        where: { id: leadId, companyId, assignedToId: userId },
        data: { status: 'PENDING' },
      });
    }
    const next = await this.pickNextLead(
      userId,
      companyId,
      session.campaignId || undefined,
      session.id,
      leadId || undefined,
    );
    return {
      skipped: true,
      session,
      lead: next.lead,
      pendingCount: next.pendingCount,
      completedCount: session.completedCount,
      tel: next.lead ? `tel:${next.lead.mobileNumber}` : null,
      reason: next.lead ? undefined : next.reason,
      autoAdvance: session.status === 'RUNNING',
    };
  }

  private async handleEnded(
    session: any,
    userId: string,
    companyId: string,
    event: {
      leadId?: string;
      duration?: number;
      disposition?: string;
      category?: string;
      remarks?: string;
      followUpDate?: string;
      followUpTime?: string;
    },
  ) {
    const leadId = event.leadId || session.currentLeadId;
    if (!leadId) throw new BadRequestException('No lead on session');

    const openCall = await this.prisma.callRecord.findFirst({
      where: { leadId, userId, companyId, endTime: null },
      orderBy: { createdAt: 'desc' },
    });

    let call = openCall;
    if (openCall) {
      const endTime = new Date();
      const duration =
        event.duration ??
        Math.max(0, Math.floor((endTime.getTime() - openCall.startTime.getTime()) / 1000));
      call = await this.prisma.callRecord.update({
        where: { id: openCall.id },
        data: {
          endTime,
          duration,
          rawCallState: 'ENDED',
          dialSessionId: session.id,
        },
      });
    } else {
      // Prefer most recent und dispositioned call for this lead/session
      const recent = await this.prisma.callRecord.findFirst({
        where: {
          leadId,
          userId,
          companyId,
          dialSessionId: session.id,
          disposition: null,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) {
        call = recent;
      } else {
        call = await this.callsService.recordCall(
          {
            leadId,
            campaignId: session.campaignId || undefined,
            startTime: new Date(Date.now() - (event.duration || 0) * 1000).toISOString(),
            endTime: new Date().toISOString(),
            duration: event.duration || 0,
            rawCallState: 'ENDED',
          } as any,
          userId,
          companyId,
        );
        await this.prisma.callRecord.update({
          where: { id: call.id },
          data: { dialSessionId: session.id },
        });
      }
    }

    if (event.disposition && call) {
      await this.callsService.submitDisposition(
        call.id,
        {
          disposition: event.disposition,
          category: event.category || 'OTHER',
          remarks: event.remarks,
          followUpDate: event.followUpDate,
          followUpTime: event.followUpTime,
        } as any,
        userId,
        companyId,
      );
      call = await this.prisma.callRecord.findUnique({ where: { id: call.id } });
    }

    const updatedSession = await this.prisma.dialSession.update({
      where: { id: session.id },
      data: {
        completedCount: { increment: 1 },
        lastCompletedLeadId: leadId,
        currentLeadId: null,
      },
    });

    let nextLead = null;
    let pendingCount = 0;
    let tel: string | null = null;
    let reason: string | undefined;
    const canAutoAdvance =
      session.status === 'RUNNING' &&
      (session.mode === 'PROGRESSIVE' || session.mode === 'POWER');

    if (canAutoAdvance) {
      const next = await this.pickNextLead(
        userId,
        companyId,
        session.campaignId || undefined,
        session.id,
        leadId,
      );
      nextLead = next.lead;
      pendingCount = next.pendingCount;
      tel = next.lead ? `tel:${next.lead.mobileNumber}` : null;
      reason = next.lead ? undefined : next.reason;
    } else {
      pendingCount = await this.countPending(
        userId,
        companyId,
        session.campaignId || undefined,
      );
    }

    this.realtime.emitToCompany(companyId, 'dialer:presence', {
      userId,
      status: session.status === 'PAUSED' ? 'PAUSED' : nextLead ? 'AVAILABLE' : 'IDLE',
      sessionId: session.id,
      leadId: nextLead?.id,
    });

    return {
      call,
      session: updatedSession,
      lead: nextLead,
      pendingCount,
      completedCount: updatedSession.completedCount,
      tel,
      reason,
      autoAdvance: canAutoAdvance,
    };
  }

  async getNext(sessionId: string, userId: string, companyId: string) {
    const session = await this.getOwnedSession(sessionId, userId, companyId);
    if (session.status === 'ENDED') {
      throw new BadRequestException('Session has ended');
    }
    if (session.status === 'PAUSED') {
      throw new BadRequestException('Session is paused — resume first');
    }
    const next = await this.pickNextLead(
      userId,
      companyId,
      session.campaignId || undefined,
      sessionId,
    );
    return {
      lead: next.lead,
      pendingCount: next.pendingCount,
      completedCount: session.completedCount,
      tel: next.lead ? `tel:${next.lead.mobileNumber}` : null,
      reason: next.lead ? undefined : next.reason,
    };
  }

  /** True when current HH:mm falls in [start, end], supporting overnight windows (e.g. 19:00–09:00). */
  private isWithinTimeWindow(timeStr: string, start: string, end: string): boolean {
    if (start <= end) {
      return timeStr >= start && timeStr <= end;
    }
    return timeStr >= start || timeStr <= end;
  }

  private async buildSessionPayload(session: any, userId: string, companyId: string) {
    let lead = null as any;
    let reason: string | undefined;
    let pendingCount = 0;
    let awaitingDisposition = false;

    if (session.currentLeadId) {
      lead = await this.prisma.lead.findFirst({
        where: { id: session.currentLeadId, companyId, assignedToId: userId },
        include: {
          campaign: { select: { id: true, name: true, maxAttemptsPerLead: true } },
        },
      });
      const openCall = lead
        ? await this.prisma.callRecord.findFirst({
            where: {
              leadId: lead.id,
              userId,
              companyId,
              dialSessionId: session.id,
              OR: [{ endTime: null }, { disposition: null }],
            },
            orderBy: { createdAt: 'desc' },
          })
        : null;
      awaitingDisposition = !!(openCall && (!openCall.endTime || !openCall.disposition));
      pendingCount = await this.countPending(
        userId,
        companyId,
        session.campaignId || undefined,
      );
    }

    if (!lead && session.status === 'RUNNING') {
      const next = await this.pickNextLead(
        userId,
        companyId,
        session.campaignId || undefined,
        session.id,
      );
      lead = next.lead;
      pendingCount = next.pendingCount;
      reason = next.lead ? undefined : next.reason;
    } else if (!lead) {
      pendingCount = await this.countPending(
        userId,
        companyId,
        session.campaignId || undefined,
      );
      reason = pendingCount === 0 ? 'empty_queue' : undefined;
    }

    return {
      session,
      lead,
      pendingCount,
      completedCount: session.completedCount || 0,
      tel: lead ? `tel:${lead.mobileNumber}` : null,
      reason,
      reattached: true,
      awaitingDisposition,
    };
  }

  private async countPending(userId: string, companyId: string, campaignId?: string | null) {
    const where: any = {
      assignedToId: userId,
      companyId,
      isBlacklisted: false,
      status: { in: DIALABLE_STATUSES },
    };
    if (campaignId) where.campaignId = campaignId;
    return this.prisma.lead.count({ where });
  }

  private async getOwnedSession(sessionId: string, userId: string, companyId: string) {
    const session = await this.prisma.dialSession.findFirst({
      where: { id: sessionId, userId, companyId },
    });
    if (!session) throw new NotFoundException('Dial session not found');
    return session;
  }

  private async assertAssignableLead(leadId: string, userId: string, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, companyId, assignedToId: userId },
    });
    if (!lead) throw new ForbiddenException('Lead is not assigned to you');
    if (lead.isBlacklisted || lead.status === 'DND') {
      throw new BadRequestException('Lead is blacklisted or DND');
    }
    if (!lead.consentGiven && process.env.REQUIRE_CONSENT === 'true') {
      throw new BadRequestException('Lead consent required before calling');
    }
    return lead;
  }

  async pickNextLead(
    userId: string,
    companyId: string,
    campaignId?: string | null,
    sessionId?: string,
    excludeLeadId?: string,
  ) {
    // Prefer session.campaignId so leads never cross campaign boundaries
    let effectiveCampaignId = campaignId || null;
    if (sessionId) {
      const session = await this.prisma.dialSession.findFirst({
        where: { id: sessionId, userId, companyId },
        select: { campaignId: true },
      });
      if (session?.campaignId) {
        effectiveCampaignId = session.campaignId;
      }
    }

    const rules = await this.prisma.callingRule.findFirst({
      where: { companyId, isActive: true },
    });

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let campaign = null as any;
    if (effectiveCampaignId) {
      campaign = await this.prisma.campaign.findFirst({
        where: { id: effectiveCampaignId, companyId },
      });
      if (campaign?.status === 'PAUSED') {
        return { lead: null, pendingCount: 0, reason: 'campaign_paused' };
      }
    }

    const maxAttempts = campaign?.maxAttemptsPerLead || rules?.maxTotalRetries || 10;
    const hoursStart = campaign?.callingHoursStart || '09:00';
    const hoursEnd = campaign?.callingHoursEnd || '23:00';

    if (!this.isWithinTimeWindow(timeStr, hoursStart, hoursEnd)) {
      return { lead: null, pendingCount: 0, reason: 'outside_calling_hours' };
    }

    if (rules?.restrictedHoursStart && rules?.restrictedHoursEnd) {
      if (
        this.isWithinTimeWindow(
          timeStr,
          rules.restrictedHoursStart,
          rules.restrictedHoursEnd,
        )
      ) {
        return { lead: null, pendingCount: 0, reason: 'restricted_hours' };
      }
    }

    const where: any = {
      assignedToId: userId,
      companyId,
      isBlacklisted: false,
      status: { in: DIALABLE_STATUSES },
      totalAttempts: { lt: maxAttempts },
    };
    if (effectiveCampaignId) where.campaignId = effectiveCampaignId;
    if (excludeLeadId) where.id = { not: excludeLeadId };

    const candidates = await this.prisma.lead.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 20,
      include: {
        campaign: { select: { id: true, name: true, maxAttemptsPerLead: true } },
      },
    });

    const minGapMin = rules?.minGapBetweenCalls || 0;
    let selected = null as any;

    for (const lead of candidates) {
      if (lead.status === 'CALL_BACK' || lead.status === 'FOLLOW_UP_REQUIRED') {
        if (lead.nextFollowUpAt && lead.nextFollowUpAt > now) continue;
      }
      if (minGapMin > 0 && lead.lastContactedAt) {
        const gapMs = now.getTime() - lead.lastContactedAt.getTime();
        if (gapMs < minGapMin * 60 * 1000) continue;
      }
      selected = lead;
      break;
    }

    if (selected && sessionId) {
      await this.prisma.dialSession.update({
        where: { id: sessionId },
        data: { currentLeadId: selected.id },
      });
    }

    const pendingCount = await this.prisma.lead.count({ where });

    return { lead: selected, pendingCount };
  }
}
