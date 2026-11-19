import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AllocationMethod,
  CampaignRoundStatus,
  LeadStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { buildAssignmentPlan } from '../../leads/allocation.engine';
import {
  DEFAULT_RECYCLE_STATUSES,
  isRecyclableStatus,
  NON_RECYCLABLE_STATUSES,
} from './round.constants';
import { PreviewRoundDto } from './dto/preview-round.dto';
import { AllocateRoundDto, CreateRoundDto } from './dto/create-round.dto';

@Injectable()
export class RoundsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ensure Round 1 exists and membership covers all campaign leads. */
  async ensureRoundOne(campaignId: string, companyId: string, createdById?: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, companyId },
      select: { id: true, companyId: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    let round = await this.prisma.campaignRound.findFirst({
      where: { campaignId, roundNumber: 1 },
    });

    if (!round) {
      round = await this.prisma.campaignRound.create({
        data: {
          campaignId,
          companyId,
          roundNumber: 1,
          status: CampaignRoundStatus.ACTIVE,
          selectionRules: { auto: true },
          startedAt: new Date(),
          createdById: createdById || null,
        },
      });
    }

    const missing = await this.prisma.lead.findMany({
      where: {
        campaignId,
        companyId,
        roundMemberships: { none: { roundId: round.id } },
      },
      select: { id: true, status: true, assignedToId: true, totalAttempts: true },
      take: 5000,
    });

    if (missing.length) {
      const chunk = 500;
      for (let i = 0; i < missing.length; i += chunk) {
        const slice = missing.slice(i, i + chunk);
        await this.prisma.campaignRoundLead.createMany({
          data: slice.map((l) => ({
            roundId: round!.id,
            leadId: l.id,
            assignedToId: l.assignedToId,
            statusAtEntry: l.status,
            roundAttemptCount: l.totalAttempts || 0,
          })),
          skipDuplicates: true,
        });
        await this.prisma.lead.updateMany({
          where: {
            id: { in: slice.map((l) => l.id) },
            companyId,
            currentRoundId: null,
          },
          data: { currentRoundId: round.id },
        });
      }
    }

    return round;
  }

  async listRounds(campaignId: string, companyId: string) {
    await this.assertCampaign(campaignId, companyId);
    await this.ensureRoundOne(campaignId, companyId);

    const rounds = await this.prisma.campaignRound.findMany({
      where: { campaignId, companyId },
      orderBy: { roundNumber: 'asc' },
    });

    const withCounts = await Promise.all(
      rounds.map(async (r) => {
        const [membership, assigned, attemptedUnique, totalAttempts] = await Promise.all([
          this.prisma.campaignRoundLead.count({ where: { roundId: r.id } }),
          this.prisma.campaignRoundLead.count({
            where: { roundId: r.id, assignedToId: { not: null } },
          }),
          this.prisma.callRecord.groupBy({
            by: ['leadId'],
            where: { roundId: r.id, companyId },
          }).then((rows) => rows.length),
          this.prisma.callRecord.count({ where: { roundId: r.id, companyId } }),
        ]);
        return {
          ...r,
          counts: {
            membership,
            assigned,
            attemptedUnique,
            totalAttempts,
            pending: Math.max(0, membership - attemptedUnique),
            completionPct:
              membership > 0
                ? Math.round((attemptedUnique / membership) * 1000) / 10
                : 0,
          },
        };
      }),
    );

    return withCounts;
  }

  async getRound(campaignId: string, roundId: string, companyId: string) {
    const round = await this.prisma.campaignRound.findFirst({
      where: { id: roundId, campaignId, companyId },
    });
    if (!round) throw new NotFoundException('Round not found');

    const membership = await this.prisma.campaignRoundLead.count({
      where: { roundId },
    });

    const byAssignee = await this.prisma.campaignRoundLead.groupBy({
      by: ['assignedToId'],
      where: { roundId },
      _count: { _all: true },
    });

    const userIds = byAssignee
      .map((r) => r.assignedToId)
      .filter((id): id is string => !!id);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds }, companyId },
          select: { id: true, name: true, employeeId: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const statusAtEntry = await this.prisma.campaignRoundLead.groupBy({
      by: ['statusAtEntry'],
      where: { roundId },
      _count: { _all: true },
    });

    const [attemptedUnique, totalAttempts] = await Promise.all([
      this.prisma.callRecord
        .groupBy({ by: ['leadId'], where: { roundId, companyId } })
        .then((rows) => rows.length),
      this.prisma.callRecord.count({ where: { roundId, companyId } }),
    ]);

    return {
      ...round,
      counts: {
        membership,
        attemptedUnique,
        totalAttempts,
        pending: Math.max(0, membership - attemptedUnique),
        completionPct:
          membership > 0
            ? Math.round((attemptedUnique / membership) * 1000) / 10
            : 0,
      },
      telecallerSplit: byAssignee.map((row) => ({
        userId: row.assignedToId,
        name: row.assignedToId
          ? userMap.get(row.assignedToId)?.name || 'Unknown'
          : 'Unassigned',
        employeeId: row.assignedToId
          ? userMap.get(row.assignedToId)?.employeeId
          : null,
        leadCount: row._count._all,
      })),
      statusAtEntry: statusAtEntry.map((s) => ({
        status: s.statusAtEntry,
        count: s._count._all,
      })),
    };
  }

  async preview(campaignId: string, companyId: string, dto: PreviewRoundDto) {
    await this.assertCampaign(campaignId, companyId);
    await this.ensureRoundOne(campaignId, companyId);

    const { leadIds, statusBreakdown } = await this.resolveEligibleLeads(
      campaignId,
      companyId,
      dto.statuses,
      dto.leadIds,
    );

    const sampleSize = Math.min(Math.max(dto.sampleSize || 25, 1), 100);
    const sample = leadIds.length
      ? await this.prisma.lead.findMany({
          where: { id: { in: leadIds.slice(0, sampleSize) }, companyId },
          select: {
            id: true,
            customerName: true,
            mobileNumber: true,
            status: true,
            assignedToId: true,
            totalAttempts: true,
            assignedTo: { select: { id: true, name: true } },
          },
        })
      : [];

    return {
      eligibleCount: leadIds.length,
      statusBreakdown,
      nonRecyclableExcluded: NON_RECYCLABLE_STATUSES,
      sample,
      leadIds: leadIds.length <= 2000 ? leadIds : undefined,
      leadIdsTruncated: leadIds.length > 2000,
    };
  }

  async createRound(
    campaignId: string,
    companyId: string,
    createdById: string,
    dto: CreateRoundDto,
  ) {
    await this.assertCampaign(campaignId, companyId);
    await this.ensureRoundOne(campaignId, companyId);

    const { leadIds, statusesUsed } = await this.resolveEligibleLeads(
      campaignId,
      companyId,
      dto.statuses,
      dto.leadIds,
    );

    if (!leadIds.length) {
      throw new BadRequestException('No eligible leads for the next round');
    }

    const maxRound = await this.prisma.campaignRound.aggregate({
      where: { campaignId, companyId },
      _max: { roundNumber: true },
    });
    const nextNumber = (maxRound._max.roundNumber || 0) + 1;
    const clearAssignees = dto.clearAssignees !== false;

    const activePrior = await this.prisma.campaignRound.findMany({
      where: {
        campaignId,
        companyId,
        status: { in: [CampaignRoundStatus.ACTIVE, CampaignRoundStatus.PLANNED] },
        roundNumber: { lt: nextNumber },
      },
      select: { id: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      for (const prior of activePrior) {
        await tx.campaignRound.update({
          where: { id: prior.id },
          data: {
            status: CampaignRoundStatus.COMPLETED,
            completedAt: new Date(),
          },
        });
      }

      const round = await tx.campaignRound.create({
        data: {
          campaignId,
          companyId,
          roundNumber: nextNumber,
          status: CampaignRoundStatus.ACTIVE,
          selectionRules: {
            statuses: statusesUsed,
            manualLeadIds: dto.leadIds || [],
            clearAssignees,
          } as any,
          startedAt: new Date(),
          createdById,
        },
      });

      const leads = await tx.lead.findMany({
        where: { id: { in: leadIds }, companyId, campaignId },
        select: { id: true, status: true, assignedToId: true },
      });

      const chunk = 400;
      for (let i = 0; i < leads.length; i += chunk) {
        const slice = leads.slice(i, i + chunk);
        await tx.campaignRoundLead.createMany({
          data: slice.map((l) => ({
            roundId: round.id,
            leadId: l.id,
            assignedToId: clearAssignees ? null : l.assignedToId,
            statusAtEntry: l.status,
            roundAttemptCount: 0,
          })),
          skipDuplicates: true,
        });

        await tx.lead.updateMany({
          where: { id: { in: slice.map((l) => l.id) }, companyId },
          data: {
            currentRoundId: round.id,
            status: LeadStatus.PENDING,
            ...(clearAssignees ? { assignedToId: null } : {}),
            needsReview: false,
          },
        });

        for (const l of slice) {
          await tx.leadStatusHistory.create({
            data: {
              leadId: l.id,
              roundId: round.id,
              fromStatus: l.status,
              toStatus: LeadStatus.PENDING,
              changedById: createdById,
              remarks: `Entered Round ${nextNumber}`,
            },
          });
        }
      }

      return round;
    });

    let allocation: any = null;
    if (dto.allocate?.userIds?.length) {
      allocation = await this.allocateRound(
        campaignId,
        result.id,
        companyId,
        createdById,
        {
          method: dto.allocate.method || AllocationMethod.EQUAL,
          userIds: dto.allocate.userIds,
          targetCounts: dto.allocate.targetCounts,
        },
      );
    }

    return { round: result, membershipCount: leadIds.length, allocation };
  }

  async allocateRound(
    campaignId: string,
    roundId: string,
    companyId: string,
    performedById: string,
    dto: AllocateRoundDto,
  ) {
    const round = await this.prisma.campaignRound.findFirst({
      where: { id: roundId, campaignId, companyId },
    });
    if (!round) throw new NotFoundException('Round not found');
    if (round.status === CampaignRoundStatus.COMPLETED) {
      throw new BadRequestException('Cannot allocate a completed round');
    }

    const memberships = await this.prisma.campaignRoundLead.findMany({
      where: { roundId, assignedToId: null },
      select: {
        leadId: true,
        lead: { select: { id: true, priority: true } },
      },
    });
    if (!memberships.length) {
      throw new BadRequestException('No unassigned leads in this round');
    }

    let userIds = dto.userIds || [];
    if (!userIds.length) {
      const roster = await this.prisma.campaignAssignment.findMany({
        where: { campaignId },
        select: { userId: true },
      });
      userIds = roster.map((r) => r.userId);
    }
    if (!userIds.length) {
      throw new BadRequestException('Select telecallers or assign them to the campaign first');
    }

    const agents = await this.prisma.user.findMany({
      where: { id: { in: userIds }, companyId, status: 'ACTIVE' },
      select: { id: true, name: true, employeeId: true, dailyTarget: true },
    });
    if (!agents.length) throw new BadRequestException('No active telecallers found');

    const openCounts = await this.prisma.lead.groupBy({
      by: ['assignedToId'],
      where: {
        companyId,
        assignedToId: { in: agents.map((a) => a.id) },
        status: {
          in: [
            LeadStatus.NEW,
            LeadStatus.ASSIGNED,
            LeadStatus.PENDING,
            LeadStatus.NOT_CONTACTED,
            LeadStatus.CALL_BACK,
            LeadStatus.FOLLOW_UP_REQUIRED,
            LeadStatus.BUSY,
            LeadStatus.NO_ANSWER,
            LeadStatus.SWITCHED_OFF,
          ],
        },
      },
      _count: { _all: true },
    });
    const openMap = new Map(
      openCounts.map((o) => [o.assignedToId!, o._count._all]),
    );

    const plan = buildAssignmentPlan(
      memberships.map((m) => ({
        id: m.leadId,
        priority: m.lead.priority,
      })),
      agents.map((a) => ({
        userId: a.id,
        openLeads: openMap.get(a.id) || 0,
        dailyTarget: a.dailyTarget || 100,
        connected: 0,
        converted: 0,
        onBreak: false,
      })),
      dto.method || AllocationMethod.EQUAL,
      {
        maxPerUser: dto.maxPerUser,
        targetCounts: dto.targetCounts,
      },
    );

    if (!plan.size) throw new BadRequestException('Allocation plan is empty');

    const allocated = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.allocationBatch.create({
        data: {
          companyId,
          campaignId,
          roundId,
          method: (dto.method || AllocationMethod.EQUAL) as any,
          ruleSnapshot: { targetCounts: dto.targetCounts, maxPerUser: dto.maxPerUser } as any,
          totalLeads: memberships.length,
          allocated: 0,
          performedById,
        },
      });

      let count = 0;
      for (const [leadId, userId] of plan.entries()) {
        const locked: Array<{ id: string }> = await tx.$queryRaw`
          SELECT id FROM leads
          WHERE id = ${leadId} AND companyId = ${companyId}
          FOR UPDATE SKIP LOCKED
        `;
        if (!locked.length) continue;

        const updated = await tx.lead.updateMany({
          where: {
            id: leadId,
            companyId,
            campaignId,
            currentRoundId: roundId,
            OR: [{ assignedToId: null }, { assignedToId: userId }],
          },
          data: {
            assignedToId: userId,
            status: LeadStatus.ASSIGNED,
            allocationBatchId: batch.id,
          },
        });
        if (!updated.count) continue;

        await tx.campaignRoundLead.updateMany({
          where: { roundId, leadId },
          data: { assignedToId: userId },
        });

        await tx.leadAssignmentHistory.create({
          data: {
            leadId,
            companyId,
            roundId,
            fromUserId: null,
            toUserId: userId,
            assignedById: performedById,
            reason: 'ROUND_ALLOCATE',
            remarks: `Round ${round.roundNumber} allocate via ${dto.method || 'EQUAL'}`,
            source: 'ROUND_ALLOCATE',
          },
        });

        await tx.leadStatusHistory.create({
          data: {
            leadId,
            roundId,
            fromStatus: LeadStatus.PENDING,
            toStatus: LeadStatus.ASSIGNED,
            changedById: performedById,
            remarks: `Round ${round.roundNumber} allocation`,
          },
        });

        count++;
      }

      await tx.allocationBatch.update({
        where: { id: batch.id },
        data: { allocated: count },
      });

      return { batchId: batch.id, allocated: count, totalLeads: memberships.length };
    });

    return { success: true, roundId, ...allocated };
  }

  async completeRound(campaignId: string, roundId: string, companyId: string) {
    const round = await this.prisma.campaignRound.findFirst({
      where: { id: roundId, campaignId, companyId },
    });
    if (!round) throw new NotFoundException('Round not found');

    return this.prisma.campaignRound.update({
      where: { id: roundId },
      data: {
        status: CampaignRoundStatus.COMPLETED,
        completedAt: new Date(),
      },
    });
  }

  async getRoundAnalytics(campaignId: string, roundId: string, companyId: string) {
    const round = await this.getRound(campaignId, roundId, companyId);

    const leadIds = (
      await this.prisma.campaignRoundLead.findMany({
        where: { roundId },
        select: { leadId: true },
      })
    ).map((m) => m.leadId);

    const [lifecycle, dispositions, imports] = await Promise.all([
      leadIds.length
        ? this.prisma.lead.groupBy({
            by: ['status'],
            where: { id: { in: leadIds }, companyId },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      this.prisma.callRecord.groupBy({
        by: ['disposition'],
        where: { roundId, companyId, disposition: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.importHistory.aggregate({
        where: { campaignId, companyId },
        _sum: {
          totalRecords: true,
          importedRecords: true,
          duplicateRecords: true,
          rejectedRecords: true,
        },
      }),
    ]);

    const telecallerPerf = await this.prisma.callRecord.groupBy({
      by: ['userId'],
      where: { roundId, companyId },
      _count: { _all: true },
    });
    const uniqueByUser = await this.prisma.$queryRaw<
      Array<{ userId: string; uniqueLeads: bigint }>
    >`
      SELECT userId, COUNT(DISTINCT leadId) AS uniqueLeads
      FROM call_records
      WHERE roundId = ${roundId} AND companyId = ${companyId}
      GROUP BY userId
    `;
    const uniqueMap = new Map(
      uniqueByUser.map((r) => [r.userId, Number(r.uniqueLeads)]),
    );
    const userIds = telecallerPerf.map((t) => t.userId);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, employeeId: true },
        })
      : [];
    const umap = new Map(users.map((u) => [u.id, u]));

    return {
      round: {
        id: round.id,
        roundNumber: round.roundNumber,
        status: round.status,
      },
      uniqueLeadsInRound: round.counts.membership,
      uniqueAttemptedLeads: round.counts.attemptedUnique,
      totalCallAttempts: round.counts.totalAttempts,
      completionPct: round.counts.completionPct,
      importTotals: {
        uploaded: imports._sum.totalRecords || 0,
        valid: imports._sum.importedRecords || 0,
        invalid: imports._sum.rejectedRecords || 0,
        duplicates: imports._sum.duplicateRecords || 0,
      },
      lifecycleBreakdown: lifecycle.map((l) => ({
        status: l.status,
        count: l._count._all,
      })),
      dispositionBreakdown: dispositions.map((d) => ({
        disposition: d.disposition,
        count: d._count._all,
      })),
      telecallerPerformance: telecallerPerf.map((t) => ({
        userId: t.userId,
        name: umap.get(t.userId)?.name,
        employeeId: umap.get(t.userId)?.employeeId,
        totalCallAttempts: t._count._all,
        uniqueLeadsAttempted: uniqueMap.get(t.userId) || 0,
      })),
      note: 'uniqueAttemptedLeads counts distinct leads with ≥1 call in this round; totalCallAttempts counts every call record.',
    };
  }

  private async assertCampaign(campaignId: string, companyId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, companyId },
      select: { id: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  private async resolveEligibleLeads(
    campaignId: string,
    companyId: string,
    statuses?: LeadStatus[],
    manualLeadIds?: string[],
  ) {
    const statusesUsed =
      statuses?.length ? statuses.filter(isRecyclableStatus) : DEFAULT_RECYCLE_STATUSES;

    if (statuses?.length && !statusesUsed.length) {
      throw new BadRequestException(
        'Selected statuses are all non-recyclable (DND / Invalid / Excluded / Converted)',
      );
    }

    const safeStatuses = statusesUsed.filter(isRecyclableStatus);
    const where: Prisma.LeadWhereInput = {
      campaignId,
      companyId,
      isBlacklisted: false,
      status: { in: safeStatuses },
    };

    if (manualLeadIds?.length) {
      where.id = { in: manualLeadIds };
    }

    const leads = await this.prisma.lead.findMany({
      where,
      select: { id: true, status: true },
    });

    const filtered = leads.filter((l) => isRecyclableStatus(l.status));
    const statusBreakdown: Record<string, number> = {};
    for (const l of filtered) {
      statusBreakdown[l.status] = (statusBreakdown[l.status] || 0) + 1;
    }

    return {
      leadIds: filtered.map((l) => l.id),
      statusesUsed,
      statusBreakdown,
    };
  }
}
