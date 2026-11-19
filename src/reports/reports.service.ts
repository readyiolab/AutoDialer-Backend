import { Injectable, NotFoundException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { clampListLimit, clampPage, clampPageSize } from '../common/utils/pagination';
import { TtlLru } from '../common/utils/ttl-lru';
import {
  BUCKET_STATUSES,
  emptyBucketCounts,
  incrementBucket,
  isConvertedStatus,
  isPendingStatus,
  statusesForBucket,
} from './lead-status-buckets';

@Injectable()
export class ReportsService {
  private readonly dashboardCache = new TtlLru<any>(200, 30_000);

  constructor(private prisma: PrismaService) {}

  async getDashboardSummary(companyId: string) {
    const cached = this.dashboardCache.get(companyId);
    if (cached) return cached;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const tomorrow = new Date(today.getTime() + 86400000);

    // Collapse status counts via groupBy instead of many lead.count calls
    const [
      leadStatusGroups,
      unassignedLeads,
      callsAttempted,
      connectedCalls,
      interestedLeads,
      activeEmployees,
      activeTelecallers,
      onlineTelecallers,
      todayCalls,
      todayConnected,
      todayMissed,
      todayDurations,
      pendingCallbacks,
      overdueCallbacks,
      whatsAppSent,
      smsSent,
      followUpsDue,
    ] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { _all: true },
      }),
      this.prisma.lead.count({ where: { companyId, assignedToId: null } }),
      this.prisma.callRecord.count({ where: { companyId } }),
      this.prisma.callRecord.count({ where: { companyId, category: 'CONNECTED' } }),
      this.prisma.callRecord.count({ where: { companyId, disposition: 'INTERESTED' } }),
      this.prisma.user.count({ where: { companyId, status: 'ACTIVE' } }),
      this.prisma.user.count({
        where: { companyId, status: 'ACTIVE', role: { name: 'TELECALLER' } },
      }),
      this.prisma.sessionLog
        .findMany({
          where: {
            isActive: true,
            loginAt: { gte: thirtyMinutesAgo },
            user: { companyId, status: 'ACTIVE', role: { name: 'TELECALLER' } },
          },
          distinct: ['userId'],
          select: { userId: true },
        })
        .then((rows) => rows.length),
      this.prisma.callRecord.count({ where: { companyId, createdAt: { gte: today } } }),
      this.prisma.callRecord.count({
        where: { companyId, category: 'CONNECTED', createdAt: { gte: today } },
      }),
      this.prisma.callRecord.count({
        where: {
          companyId,
          createdAt: { gte: today },
          disposition: { in: ['NOT_PICKED', 'BUSY', 'SWITCHED_OFF', 'NOT_REACHABLE'] },
        },
      }),
      this.prisma.callRecord.aggregate({
        where: { companyId, category: 'CONNECTED', createdAt: { gte: today } },
        _avg: { duration: true },
        _sum: { duration: true },
      }),
      this.prisma.followUp.count({ where: { companyId, status: 'PENDING' } }),
      this.prisma.followUp.count({
        where: { companyId, status: 'PENDING', scheduledDate: { lt: today } },
      }),
      this.prisma.communicationLog.count({ where: { companyId, type: 'WHATSAPP' } }),
      this.prisma.communicationLog.count({ where: { companyId, type: 'SMS' } }),
      this.prisma.followUp.count({
        where: {
          companyId,
          status: 'PENDING',
          scheduledDate: { gte: today, lt: tomorrow },
        },
      }),
    ]);

    const statusCount = (names: string[]) =>
      leadStatusGroups
        .filter((g) => names.includes(String(g.status)))
        .reduce((acc, g) => acc + g._count._all, 0);

    const totalLeads = leadStatusGroups.reduce((acc, g) => acc + g._count._all, 0);
    const assignedLeads = Math.max(0, totalLeads - unassignedLeads);
    const pendingLeads = statusCount(['PENDING', 'NEW', 'ASSIGNED', 'NOT_CONTACTED']);
    const contactedLeads = statusCount(['CONTACTED']);
    const interestedLeadCount = statusCount(['INTERESTED']);
    const convertedLeads = statusCount(['CONVERTED']);

    const avgDurationSeconds = Math.round(todayDurations._avg.duration || 0);
    const avgMinutes = Math.floor(avgDurationSeconds / 60);
    const avgRemainingSeconds = avgDurationSeconds % 60;
    const avgCallDurationFormatted = `${avgMinutes}:${avgRemainingSeconds < 10 ? '0' : ''}${avgRemainingSeconds}`;

    const connectionRate =
      todayCalls > 0 ? ((todayConnected / todayCalls) * 100).toFixed(1) + '%' : '0%';
    const conversionPercentage =
      totalLeads > 0 ? Number(((convertedLeads / totalLeads) * 100).toFixed(1)) : 0;

    const summary = {
      totalLeads,
      unassignedLeads,
      assignedLeads,
      pendingLeads,
      contactedLeads,
      interestedLeadCount,
      convertedLeads,
      conversionPercentage,
      callsAttempted,
      connectedCalls,
      interestedLeads,
      activeEmployees,
      activeTelecallers,
      onlineTelecallers,
      todayCalls,
      todayConnected,
      todayMissed,
      successfulCalls: todayConnected,
      missedCalls: todayMissed,
      avgCallDurationFormatted,
      avgDurationSeconds,
      connectionRate,
      pendingCallbacks,
      overdueCallbacks,
      followUpsDue,
      whatsAppSent,
      smsSent,
    };
    this.dashboardCache.set(companyId, summary);
    return summary;
  }

  private buildCallWhere(params: {
    dateFrom?: string;
    dateTo?: string;
    campaignId?: string;
    branchId?: string;
    companyId: string;
  }) {
    const where: any = { companyId: params.companyId };
    if (params.campaignId) where.campaignId = params.campaignId;
    if (params.branchId) where.user = { branchId: params.branchId };
    if (params.dateFrom || params.dateTo) {
      where.createdAt = {};
      if (params.dateFrom) where.createdAt.gte = new Date(params.dateFrom);
      if (params.dateTo) where.createdAt.lte = new Date(params.dateTo);
    }
    return where;
  }

  async getDailyCallingMIS(params: {
    dateFrom?: string;
    dateTo?: string;
    branchId?: string;
    campaignId?: string;
    companyId: string;
  }) {
    const where = this.buildCallWhere(params);
    const { companyId } = params;

    const [
      totalCalls,
      connectedCalls,
      dispositionGroups,
      durationAgg,
      uniqueLeadGroups,
      totalLeadsAllocated,
      pendingLeads,
    ] = await Promise.all([
      this.prisma.callRecord.count({ where }),
      this.prisma.callRecord.count({ where: { ...where, category: 'CONNECTED' } }),
      this.prisma.callRecord.groupBy({
        by: ['disposition'],
        where,
        _count: { id: true },
      }),
      this.prisma.callRecord.aggregate({
        where,
        _sum: { duration: true },
        _avg: { duration: true },
      }),
      // COUNT(DISTINCT leadId) without loading every leadId into memory as full rows
      this.prisma.callRecord.groupBy({
        by: ['leadId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.lead.count({ where: { companyId } }),
      this.prisma.lead.count({ where: { companyId, status: 'NEW' } }),
    ]);

    const dispositionCount = (name: string) =>
      dispositionGroups.find((d) => d.disposition === name)?._count.id || 0;

    const totalTalkTimeSeconds = durationAgg._sum.duration || 0;
    const avgDuration = Math.round(durationAgg._avg.duration || 0);
    const interested = dispositionCount('INTERESTED');

    return {
      totalLeadsAllocated,
      totalCallsAttempted: totalCalls,
      uniqueCustomersCalled: uniqueLeadGroups.length,
      connectedCalls,
      notPicked: dispositionCount('NOT_PICKED'),
      busy: dispositionCount('BUSY'),
      switchedOff: dispositionCount('SWITCHED_OFF'),
      notReachable: dispositionCount('NOT_REACHABLE'),
      interested,
      notInterested: dispositionCount('NOT_INTERESTED'),
      callBack: dispositionCount('CALL_BACK'),
      wrongNumber: dispositionCount('WRONG_NUMBER'),
      averageCallDuration: `${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s`,
      totalTalkTime: `${Math.floor(totalTalkTimeSeconds / 3600)}h ${Math.floor((totalTalkTimeSeconds % 3600) / 60)}m`,
      pendingLeads,
      connectionPercentage:
        totalCalls > 0 ? ((connectedCalls / totalCalls) * 100).toFixed(1) + '%' : '0%',
      interestedPercentage:
        connectedCalls > 0 ? ((interested / connectedCalls) * 100).toFixed(1) + '%' : '0%',
    };
  }

  private async resolveTelecallers(
    companyId: string,
    opts: { teamId?: string; campaignId?: string } = {},
  ) {
    const membershipFilter = opts.campaignId
      ? { campaignAssignments: { some: { campaignId: opts.campaignId } } }
      : {};
    const roleFilter = {
      companyId,
      status: 'ACTIVE' as const,
      ...(opts.teamId ? { teamId: opts.teamId } : {}),
      ...membershipFilter,
      role: { name: 'TELECALLER' },
    };

    let users = await this.prisma.user.findMany({
      where: roleFilter,
      take: clampListLimit(),
      select: {
        id: true,
        name: true,
        employeeId: true,
        dailyTarget: true,
        branch: { select: { name: true } },
        team: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });

    if (!users.length) {
      users = await this.prisma.user.findMany({
        where: {
          companyId,
          status: 'ACTIVE',
          ...(opts.teamId ? { teamId: opts.teamId } : {}),
          ...membershipFilter,
          assignedLeads: {
            some: {
              companyId,
              ...(opts.campaignId ? { campaignId: opts.campaignId } : {}),
            },
          },
        },
        take: clampListLimit(),
        select: {
          id: true,
          name: true,
          employeeId: true,
          dailyTarget: true,
          branch: { select: { name: true } },
          team: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      });
    }

    return users;
  }

  async getTelecallerLeadOverview(
    companyId: string,
    opts: { campaignId?: string; teamId?: string } = {},
  ) {
    const users = await this.resolveTelecallers(companyId, opts);
    if (!users.length) {
      return { employees: [], totals: { ...emptyBucketCounts(), total: 0 } };
    }

    const userIds = users.map((u) => u.id);
    const leadWhere: any = {
      companyId,
      assignedToId: { in: userIds },
    };
    if (opts.campaignId) leadWhere.campaignId = opts.campaignId;

    const grouped = await this.prisma.lead.groupBy({
      by: ['assignedToId', 'status'],
      where: leadWhere,
      _count: { id: true },
    });

    const byUser = new Map<string, ReturnType<typeof emptyBucketCounts> & { total: number }>();
    for (const u of users) {
      byUser.set(u.id, { ...emptyBucketCounts(), total: 0 });
    }

    for (const row of grouped) {
      if (!row.assignedToId) continue;
      const bucket = byUser.get(row.assignedToId);
      if (!bucket) continue;
      incrementBucket(bucket, row.status, row._count.id);
      bucket.total += row._count.id;
    }

    const employees = users.map((u) => {
      const c = byUser.get(u.id)!;
      return {
        userId: u.id,
        id: u.id,
        name: u.name,
        employeeId: u.employeeId,
        team: u.team?.name || null,
        total: c.total,
        pending: c.pending,
        followUp: c.followUp,
        interested: c.interested,
        converted: c.converted,
        rejected: c.rejected,
        invalid: c.invalid,
        contacted: c.contacted,
      };
    });

    const totals = employees.reduce(
      (acc, row) => {
        acc.total += row.total;
        acc.pending += row.pending;
        acc.followUp += row.followUp;
        acc.interested += row.interested;
        acc.converted += row.converted;
        acc.rejected += row.rejected;
        acc.invalid += row.invalid;
        acc.contacted += row.contacted;
        return acc;
      },
      { ...emptyBucketCounts(), total: 0 },
    );

    return { employees, totals };
  }

  async getEmployeeProductivityMIS(
    companyId: string,
    opts: { campaignId?: string; dateFrom?: string; dateTo?: string } = {},
  ) {
    const campaignId = opts.campaignId?.trim() || undefined;
    // Default last 7 days — never scan all-history
    const dateTo = opts.dateTo ? new Date(opts.dateTo) : new Date();
    const dateFrom = opts.dateFrom
      ? new Date(opts.dateFrom)
      : new Date(dateTo.getTime() - 7 * 86400000);

    const users = await this.resolveTelecallers(companyId, { campaignId });
    if (users.length === 0) {
      return {
        employees: [],
        summary: null,
        campaignId: campaignId || null,
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
      };
    }

    const userIds = users.map((u) => u.id);
    const callWhere: any = {
      companyId,
      userId: { in: userIds },
      createdAt: { gte: dateFrom, lte: dateTo },
    };
    const leadWhere: any = { companyId, assignedToId: { in: userIds } };
    if (campaignId) {
      callWhere.campaignId = campaignId;
      leadWhere.campaignId = campaignId;
    }

    const [byUserCategory, byUserDisposition, durationByUser, leadStatusGroups, contactedCounts] =
      await Promise.all([
        this.prisma.callRecord.groupBy({
          by: ['userId', 'category'],
          where: callWhere,
          _count: { id: true },
        }),
        this.prisma.callRecord.groupBy({
          by: ['userId', 'disposition'],
          where: callWhere,
          _count: { id: true },
        }),
        this.prisma.callRecord.groupBy({
          by: ['userId'],
          where: callWhere,
          _sum: { duration: true },
        }),
        this.prisma.lead.groupBy({
          by: ['assignedToId', 'status'],
          where: leadWhere,
          _count: { id: true },
        }),
        this.prisma.lead.groupBy({
          by: ['assignedToId'],
          where: {
            ...leadWhere,
            OR: [
              { totalAttempts: { gt: 0 } },
              { status: { notIn: BUCKET_STATUSES.pending } },
            ],
          },
          _count: { id: true },
        }),
      ]);

    const totalByUser = new Map<string, number>();
    const connectedByUser = new Map<string, number>();
    for (const row of byUserCategory) {
      totalByUser.set(row.userId, (totalByUser.get(row.userId) || 0) + row._count.id);
      if (row.category === 'CONNECTED') {
        connectedByUser.set(row.userId, row._count.id);
      }
    }

    const interestedByDisposition = new Map<string, number>();
    const callbackByUser = new Map<string, number>();
    for (const row of byUserDisposition) {
      if (row.disposition === 'INTERESTED') {
        interestedByDisposition.set(row.userId, row._count.id);
      }
      if (row.disposition === 'CALL_BACK') {
        callbackByUser.set(row.userId, row._count.id);
      }
    }

    const talkByUser = new Map(
      durationByUser.map((r) => [r.userId, r._sum.duration || 0]),
    );

    const leadBuckets = new Map<string, ReturnType<typeof emptyBucketCounts> & { total: number; notInterested: number }>();
    for (const id of userIds) {
      leadBuckets.set(id, { ...emptyBucketCounts(), total: 0, notInterested: 0 });
    }
    for (const row of leadStatusGroups) {
      if (!row.assignedToId) continue;
      const bucket = leadBuckets.get(row.assignedToId);
      if (!bucket) continue;
      incrementBucket(bucket, row.status, row._count.id);
      bucket.total += row._count.id;
      if (row.status === LeadStatus.NOT_INTERESTED) {
        bucket.notInterested += row._count.id;
      }
    }

    const contactedByUser = new Map(
      contactedCounts.map((r) => [r.assignedToId!, r._count.id]),
    );

    const employees = users.map((u) => {
      const totalCalls = totalByUser.get(u.id) || 0;
      const connected = connectedByUser.get(u.id) || 0;
      const unsuccessful = totalCalls - connected;
      const totalTalkTimeSec = talkByUser.get(u.id) || 0;
      const aht = connected > 0 ? Math.round(totalTalkTimeSec / connected) : 0;
      const lb = leadBuckets.get(u.id)!;
      const totalAssigned = lb.total;
      const totalContacted = contactedByUser.get(u.id) || 0;
      const conversionRate =
        totalAssigned > 0 ? Number(((lb.converted / totalAssigned) * 100).toFixed(1)) : 0;
      const rawScore = totalContacted * 1 + lb.interested * 2 + lb.converted * 5;
      const maxScore = Math.max(totalAssigned * 5, 1);
      const overallProductivity = Math.min(100, Math.round((rawScore / maxScore) * 100));
      const achievementRate =
        u.dailyTarget > 0 ? ((totalCalls / u.dailyTarget) * 100).toFixed(1) + '%' : '0%';

      return {
        id: u.id,
        userId: u.id,
        name: u.name,
        employeeId: u.employeeId,
        branch: u.branch?.name || 'Main',
        team: u.team?.name || null,
        totalAssigned,
        totalContacted,
        pendingLeads: lb.pending,
        followUps: lb.followUp,
        interestedLeads: lb.interested,
        notInterestedLeads: lb.notInterested,
        convertedLeads: lb.converted,
        rejectedLeads: lb.rejected,
        conversionRate,
        conversionRateLabel: `${conversionRate}%`,
        overallProductivity,
        totalCalls,
        connectedCalls: connected,
        unsuccessfulCalls: unsuccessful,
        talkTime: `${Math.floor(totalTalkTimeSec / 60)}m ${totalTalkTimeSec % 60}s`,
        aht: `${Math.floor(aht / 60)}m ${aht % 60}s`,
        callBackCount: callbackByUser.get(u.id) || 0,
        dispositionInterested: interestedByDisposition.get(u.id) || 0,
        dailyTarget: u.dailyTarget,
        achievementRate,
        score: connected * 2 + (interestedByDisposition.get(u.id) || 0) * 5 + lb.converted * 5,
      };
    });

    employees.sort((a, b) => b.overallProductivity - a.overallProductivity || b.score - a.score);

    const summary = employees.reduce(
      (acc, e) => {
        acc.totalAssigned += e.totalAssigned;
        acc.totalContacted += e.totalContacted;
        acc.pending += e.pendingLeads;
        acc.followUps += e.followUps;
        acc.interested += e.interestedLeads;
        acc.converted += e.convertedLeads;
        acc.rejected += e.rejectedLeads;
        return acc;
      },
      {
        totalAssigned: 0,
        totalContacted: 0,
        pending: 0,
        followUps: 0,
        interested: 0,
        converted: 0,
        rejected: 0,
        employeeCount: employees.length,
      },
    );

    return { employees, summary, campaignId: campaignId || null };
  }

  async getEmployeeLeads(
    companyId: string,
    userId: string,
    query: {
      status?: string;
      bucket?: string;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
      campaignId?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId },
      select: {
        id: true,
        name: true,
        employeeId: true,
        phone: true,
        dailyTarget: true,
        team: { select: { name: true } },
        branch: { select: { name: true } },
      },
    });
    if (!user) throw new NotFoundException('Employee not found');

    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);
    const skip = (page - 1) * pageSize;

    const where: any = { companyId, assignedToId: userId };
    if (query.campaignId) where.campaignId = query.campaignId;

    if (query.search) {
      where.OR = [
        { customerName: { contains: query.search, mode: 'insensitive' } },
        { mobileNumber: { contains: query.search } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.status) {
      where.status = query.status as LeadStatus;
    } else if (query.bucket) {
      const statuses = statusesForBucket(query.bucket);
      if (statuses?.length) where.status = { in: statuses };
    }

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    const [total, leads, statusGroups] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
        include: {
          campaign: { select: { id: true, name: true } },
          callRecords: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: { remarks: true, disposition: true, createdAt: true },
          },
        },
      }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { companyId, assignedToId: userId },
        _count: { id: true },
      }),
    ]);

    const chips = { ...emptyBucketCounts(), total: 0, notInterested: 0 };
    for (const row of statusGroups) {
      incrementBucket(chips, row.status, row._count.id);
      chips.total += row._count.id;
      if (row.status === LeadStatus.NOT_INTERESTED) {
        chips.notInterested += row._count.id;
      }
    }

    const data = leads.map((lead) => {
      const latest = lead.callRecords[0];
      return {
        id: lead.id,
        customerName: lead.customerName,
        mobileNumber: lead.mobileNumber,
        email: lead.email,
        assignedDate: lead.createdAt,
        lastContactDate: lead.lastContactedAt,
        status: lead.status,
        followUpDate: lead.nextFollowUpAt,
        remarks: latest?.remarks || null,
        lastDisposition: latest?.disposition || null,
        totalAttempts: lead.totalAttempts,
        conversionStatus: isConvertedStatus(lead.status) ? 'Converted' : 'Not converted',
        isConverted: isConvertedStatus(lead.status),
        isPending: isPendingStatus(lead.status),
        campaign: lead.campaign,
      };
    });

    return {
      employee: user,
      chips,
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getCampaignMIS(companyId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { companyId },
      take: clampListLimit(),
      include: {
        _count: { select: { leads: true, callRecords: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (campaigns.length === 0) {
      return [];
    }

    const campaignIds = campaigns.map((c) => c.id);

    const [byCampaignCategory, byCampaignDisposition, uniqueLeads] = await Promise.all([
      this.prisma.callRecord.groupBy({
        by: ['campaignId', 'category'],
        where: { companyId, campaignId: { in: campaignIds } },
        _count: { id: true },
      }),
      this.prisma.callRecord.groupBy({
        by: ['campaignId', 'disposition'],
        where: { companyId, campaignId: { in: campaignIds } },
        _count: { id: true },
      }),
      this.prisma.callRecord.groupBy({
        by: ['campaignId', 'leadId'],
        where: { companyId, campaignId: { in: campaignIds } },
        _count: { id: true },
      }),
    ]);

    const totalByCampaign = new Map<string, number>();
    const connectedByCampaign = new Map<string, number>();
    for (const row of byCampaignCategory) {
      if (!row.campaignId) continue;
      totalByCampaign.set(
        row.campaignId,
        (totalByCampaign.get(row.campaignId) || 0) + row._count.id,
      );
      if (row.category === 'CONNECTED') {
        connectedByCampaign.set(row.campaignId, row._count.id);
      }
    }

    const interestedByCampaign = new Map<string, number>();
    const callbackByCampaign = new Map<string, number>();
    for (const row of byCampaignDisposition) {
      if (!row.campaignId) continue;
      if (row.disposition === 'INTERESTED') {
        interestedByCampaign.set(row.campaignId, row._count.id);
      }
      if (row.disposition === 'CALL_BACK') {
        callbackByCampaign.set(row.campaignId, row._count.id);
      }
    }

    const uniqueByCampaign = new Map<string, number>();
    for (const row of uniqueLeads) {
      if (!row.campaignId) continue;
      uniqueByCampaign.set(row.campaignId, (uniqueByCampaign.get(row.campaignId) || 0) + 1);
    }

    return campaigns.map((camp) => {
      const totalLeads = camp._count.leads;
      const totalCalls = totalByCampaign.get(camp.id) || camp._count.callRecords;
      const connected = connectedByCampaign.get(camp.id) || 0;
      const interested = interestedByCampaign.get(camp.id) || 0;
      const callbacks = callbackByCampaign.get(camp.id) || 0;
      const uniqueCalled = uniqueByCampaign.get(camp.id) || 0;

      return {
        id: camp.id,
        name: camp.name,
        status: camp.status,
        totalLeads,
        uniqueCalled,
        coverageRate:
          totalLeads > 0 ? ((uniqueCalled / totalLeads) * 100).toFixed(1) + '%' : '0%',
        totalCalls,
        connected,
        interested,
        callbacks,
        connectionRate:
          totalCalls > 0 ? ((connected / totalCalls) * 100).toFixed(1) + '%' : '0%',
        conversionRate:
          totalLeads > 0 ? ((interested / totalLeads) * 100).toFixed(1) + '%' : '0%',
      };
    });
  }

  async getBranchMIS(companyId: string) {
    const branches = await this.prisma.branch.findMany({
      where: { companyId },
      take: clampListLimit(),
      include: {
        _count: { select: { users: true } },
        users: { select: { id: true } },
      },
      orderBy: { name: 'asc' },
    });

    const allUserIds = branches.flatMap((b) => b.users.map((u) => u.id));
    const userToBranch = new Map<string, string>();
    for (const b of branches) {
      for (const u of b.users) userToBranch.set(u.id, b.id);
    }

    const emptyStats = () => ({ totalCalls: 0, connected: 0, interested: 0 });
    const byBranch = new Map<string, { totalCalls: number; connected: number; interested: number }>();
    for (const b of branches) byBranch.set(b.id, emptyStats());

    if (allUserIds.length) {
      const [byUser, byUserConnected, byUserInterested] = await Promise.all([
        this.prisma.callRecord.groupBy({
          by: ['userId'],
          where: { companyId, userId: { in: allUserIds } },
          _count: { _all: true },
        }),
        this.prisma.callRecord.groupBy({
          by: ['userId'],
          where: { companyId, userId: { in: allUserIds }, category: 'CONNECTED' },
          _count: { _all: true },
        }),
        this.prisma.callRecord.groupBy({
          by: ['userId'],
          where: { companyId, userId: { in: allUserIds }, disposition: 'INTERESTED' },
          _count: { _all: true },
        }),
      ]);

      const apply = (
        rows: { userId: string; _count: { _all: number } }[],
        field: 'totalCalls' | 'connected' | 'interested',
      ) => {
        for (const row of rows) {
          const branchId = userToBranch.get(row.userId);
          if (!branchId) continue;
          const stats = byBranch.get(branchId) || emptyStats();
          stats[field] += row._count._all;
          byBranch.set(branchId, stats);
        }
      };
      apply(byUser, 'totalCalls');
      apply(byUserConnected, 'connected');
      apply(byUserInterested, 'interested');
    }

    return branches.map((b) => {
      const stats = byBranch.get(b.id) || emptyStats();
      return {
        id: b.id,
        name: b.name,
        state: b.state || '-',
        city: b.city || '-',
        telecallersCount: b._count.users,
        totalCalls: stats.totalCalls,
        connectedCalls: stats.connected,
        interestedLeads: stats.interested,
        connectionRate:
          stats.totalCalls > 0
            ? ((stats.connected / stats.totalCalls) * 100).toFixed(1) + '%'
            : '0%',
      };
    });
  }

  async getCommunicationMIS(companyId: string) {
    const [totalMessages, byType, byStatus] = await Promise.all([
      this.prisma.communicationLog.count({ where: { companyId } }),
      this.prisma.communicationLog.groupBy({
        by: ['type'],
        where: { companyId },
        _count: { id: true },
      }),
      this.prisma.communicationLog.groupBy({
        by: ['status'],
        where: { companyId },
        _count: { id: true },
      }),
    ]);

    const typeCount = (name: string) =>
      byType.find((t) => t.type === name)?._count.id || 0;
    const statusCount = (...names: string[]) =>
      byStatus
        .filter((s) => names.includes(s.status))
        .reduce((acc, s) => acc + s._count.id, 0);

    const delivered = statusCount('DELIVERED', 'READ');
    const read = statusCount('READ');
    const failed = statusCount('FAILED');

    return {
      totalMessages,
      totalWhatsApp: typeCount('WHATSAPP'),
      totalSMS: typeCount('SMS'),
      delivered,
      read,
      failed,
      deliveryRate:
        totalMessages > 0 ? ((delivered / totalMessages) * 100).toFixed(1) + '%' : '0%',
    };
  }
}
