import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { CampaignStatus } from '@prisma/client';
import { clampListLimit } from '../common/utils/pagination';

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateCampaignDto, companyId: string, userId: string) {
    return this.prisma.campaign.create({
      data: {
        name: createDto.name,
        description: createDto.description,
        type: createDto.type,
        startDate: createDto.startDate ? new Date(createDto.startDate) : undefined,
        endDate: createDto.endDate ? new Date(createDto.endDate) : undefined,
        status: createDto.status,
        dialMode: createDto.dialMode,
        allocationMethod: createDto.allocationMethod,
        allocationRules: (createDto.allocationRules as any) || undefined,
        maxAttemptsPerLead: createDto.maxAttemptsPerLead,
        callingHoursStart: createDto.callingHoursStart,
        callingHoursEnd: createDto.callingHoursEnd,
        retryInterval: createDto.retryInterval,
        dailyTarget: createDto.dailyTarget,
        companyId,
        createdById: userId,
      },
    });
  }

  async findAll(companyId: string) {
    return this.prisma.campaign.findMany({
      where: { companyId },
      take: clampListLimit(),
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { leads: true, callRecords: true, assignments: true },
        },
      },
    });
  }

  async findOne(id: string, companyId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, companyId },
      include: {
        assignments: {
          include: { user: { select: { id: true, name: true, phone: true, employeeId: true } } },
        },
        _count: {
          select: { leads: true, callRecords: true },
        },
      },
    });

    if (!campaign) throw new NotFoundException(`Campaign with ID ${id} not found.`);
    return campaign;
  }

  async update(id: string, updateDto: UpdateCampaignDto, companyId: string) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, companyId } });
    if (!campaign) throw new NotFoundException(`Campaign with ID ${id} not found.`);

    const data: any = { ...updateDto };
    if (updateDto.startDate) data.startDate = new Date(updateDto.startDate);
    if (updateDto.endDate) data.endDate = new Date(updateDto.endDate);
    if (updateDto.allocationRules) data.allocationRules = updateDto.allocationRules as any;

    return this.prisma.campaign.update({
      where: { id },
      data,
    });
  }

  async setStatus(id: string, status: CampaignStatus, companyId: string) {
    return this.update(id, { status }, companyId);
  }

  async assignUsers(campaignId: string, userIds: string[], companyId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, companyId },
    });
    if (!campaign) throw new NotFoundException(`Campaign with ID ${campaignId} not found.`);

    const uniqueIds = Array.from(new Set(userIds));
    const validCount = await this.prisma.user.count({
      where: { id: { in: uniqueIds }, companyId, status: 'ACTIVE' },
    });
    if (validCount !== uniqueIds.length) {
      throw new ForbiddenException('One or more users do not belong to this company');
    }

    const creates = uniqueIds.map((userId) =>
      this.prisma.campaignAssignment.upsert({
        where: {
          campaignId_userId: { campaignId, userId },
        },
        create: { campaignId, userId },
        update: {},
      }),
    );

    await this.prisma.$transaction(creates);
    return { success: true, assignedUsers: uniqueIds.length };
  }

  /** Remove CampaignAssignment rows only — does not delete call history or leads. */
  async removeUsers(campaignId: string, userIds: string[], companyId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, companyId },
    });
    if (!campaign) throw new NotFoundException(`Campaign with ID ${campaignId} not found.`);

    const uniqueIds = Array.from(new Set(userIds || []));
    if (!uniqueIds.length) {
      throw new BadRequestException('userIds is required');
    }

    const result = await this.prisma.campaignAssignment.deleteMany({
      where: { campaignId, userId: { in: uniqueIds } },
    });

    return { success: true, removedUsers: result.count };
  }

  /** Replace campaign telecaller roster: remove then assign. Call history is preserved. */
  async replaceUsers(campaignId: string, userIds: string[], companyId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id: campaignId, companyId },
    });
    if (!campaign) throw new NotFoundException(`Campaign with ID ${campaignId} not found.`);

    const uniqueIds = Array.from(new Set(userIds || []));
    if (uniqueIds.length) {
      const validCount = await this.prisma.user.count({
        where: { id: { in: uniqueIds }, companyId, status: 'ACTIVE' },
      });
      if (validCount !== uniqueIds.length) {
        throw new ForbiddenException('One or more users do not belong to this company');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.campaignAssignment.deleteMany({ where: { campaignId } });
      if (uniqueIds.length) {
        await tx.campaignAssignment.createMany({
          data: uniqueIds.map((userId) => ({ campaignId, userId })),
          skipDuplicates: true,
        });
      }
    });

    return { success: true, assignedUsers: uniqueIds.length };
  }

  async getStats(id: string, companyId: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!campaign) throw new NotFoundException(`Campaign with ID ${id} not found.`);

    const now = new Date();
    const pendingStatuses = [
      'NEW',
      'ASSIGNED',
      'PENDING',
      'NOT_CONTACTED',
      'CALL_BACK',
      'FOLLOW_UP_REQUIRED',
      'BUSY',
      'NO_ANSWER',
      'SWITCHED_OFF',
    ] as const;

    const [
      totalLeads,
      assignedLeads,
      unassignedLeads,
      totalTelecallers,
      contactedLeads,
      pendingLeads,
      interestedLeads,
      followUpsDue,
      convertedLeads,
      totalCalls,
      connectedCalls,
      interestedCallDispositions,
    ] = await Promise.all([
      this.prisma.lead.count({ where: { campaignId: id, companyId } }),
      this.prisma.lead.count({
        where: { campaignId: id, companyId, assignedToId: { not: null } },
      }),
      this.prisma.lead.count({
        where: { campaignId: id, companyId, assignedToId: null },
      }),
      this.prisma.campaignAssignment.count({
        where: { campaignId: id, user: { companyId, status: 'ACTIVE' } },
      }),
      this.prisma.lead.count({
        where: {
          campaignId: id,
          companyId,
          OR: [{ totalAttempts: { gt: 0 } }, { lastContactedAt: { not: null } }],
        },
      }),
      this.prisma.lead.count({
        where: {
          campaignId: id,
          companyId,
          status: { in: pendingStatuses as any },
        },
      }),
      this.prisma.lead.count({
        where: { campaignId: id, companyId, status: 'INTERESTED' },
      }),
      this.prisma.followUp.count({
        where: {
          companyId,
          status: { in: ['PENDING', 'OVERDUE'] },
          scheduledDate: { lte: now },
          lead: { campaignId: id, companyId },
        },
      }),
      this.prisma.lead.count({
        where: { campaignId: id, companyId, status: 'CONVERTED' },
      }),
      this.prisma.callRecord.count({ where: { campaignId: id, companyId } }),
      this.prisma.callRecord.count({
        where: { campaignId: id, companyId, category: 'CONNECTED' },
      }),
      this.prisma.callRecord.count({
        where: { campaignId: id, companyId, disposition: 'INTERESTED' },
      }),
    ]);

    const conversionRate =
      totalLeads > 0 ? Number(((convertedLeads / totalLeads) * 100).toFixed(1)) : 0;

    return {
      totalLeads,
      assignedLeads,
      unassignedLeads,
      totalTelecallers,
      contactedLeads,
      pendingLeads,
      interestedLeads,
      followUpsDue,
      convertedLeads,
      conversionRate,
      // retained for existing clients
      totalCalls,
      connectedCalls,
      connectionRate:
        totalCalls > 0 ? ((connectedCalls / totalCalls) * 100).toFixed(1) + '%' : '0%',
      interestRate:
        connectedCalls > 0
          ? ((interestedCallDispositions / connectedCalls) * 100).toFixed(1) + '%'
          : '0%',
    };
  }
}
