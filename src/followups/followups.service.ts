import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FollowUpStatus } from '@prisma/client';
import { clampListLimit } from '../common/utils/pagination';

@Injectable()
export class FollowUpsService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: {
    type?: 'today' | 'overdue' | 'pending';
    userId?: string;
    companyId: string;
  }) {
    const { type, userId, companyId } = params;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const where: any = { companyId };
    if (userId) where.userId = userId;

    if (type === 'today') {
      where.scheduledDate = { gte: todayStart, lte: todayEnd };
      where.status = { in: [FollowUpStatus.PENDING, FollowUpStatus.OVERDUE] };
    } else if (type === 'overdue') {
      where.OR = [
        { status: FollowUpStatus.OVERDUE },
        { status: FollowUpStatus.PENDING, scheduledDate: { lt: todayStart } },
      ];
    } else if (type === 'pending') {
      where.status = { in: [FollowUpStatus.PENDING, FollowUpStatus.OVERDUE] };
    }

    return this.prisma.followUp.findMany({
      where,
      take: clampListLimit(),
      orderBy: { scheduledDate: 'asc' },
      include: {
        lead: {
          select: {
            id: true,
            customerName: true,
            mobileNumber: true,
            loanAmount: true,
            city: true,
            status: true,
          },
        },
        user: { select: { id: true, name: true, employeeId: true } },
      },
    });
  }

  async markComplete(id: string, remarks: string, companyId: string) {
    const followUp = await this.prisma.followUp.findFirst({ where: { id, companyId } });
    if (!followUp) throw new NotFoundException('Follow-up not found');

    return this.prisma.followUp.update({
      where: { id },
      data: {
        status: FollowUpStatus.COMPLETED,
        completedAt: new Date(),
        remarks: remarks || followUp.remarks,
      },
    });
  }

  private async assertUserInCompany(userId: string, companyId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!user) {
      throw new ForbiddenException('Target user does not belong to this company');
    }
  }

  async reassign(id: string, reassignedToId: string, companyId: string) {
    const followUp = await this.prisma.followUp.findFirst({ where: { id, companyId } });
    if (!followUp) throw new NotFoundException('Follow-up not found');
    await this.assertUserInCompany(reassignedToId, companyId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.followUp.update({
        where: { id },
        data: {
          reassignedToId,
          userId: reassignedToId,
          status: FollowUpStatus.REASSIGNED,
        },
      });

      await tx.lead.updateMany({
        where: { id: followUp.leadId, companyId },
        data: { assignedToId: reassignedToId },
      });

      if (followUp.roundId) {
        await tx.campaignRoundLead.updateMany({
          where: { roundId: followUp.roundId, leadId: followUp.leadId },
          data: { assignedToId: reassignedToId },
        });
      }

      return updated;
    });
  }

  async reschedule(
    id: string,
    companyId: string,
    data: { scheduledDate: string; scheduledTime?: string; remarks?: string },
  ) {
    const followUp = await this.prisma.followUp.findFirst({ where: { id, companyId } });
    if (!followUp) throw new NotFoundException('Follow-up not found');

    const scheduledDate = new Date(data.scheduledDate);
    if (Number.isNaN(scheduledDate.getTime())) {
      throw new BadRequestException('Invalid scheduledDate');
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.followUp.update({
        where: { id },
        data: {
          scheduledDate,
          scheduledTime: data.scheduledTime ?? followUp.scheduledTime,
          remarks: data.remarks ?? followUp.remarks,
          status: FollowUpStatus.PENDING,
          completedAt: null,
        },
      }),
      this.prisma.lead.updateMany({
        where: { id: followUp.leadId, companyId },
        data: { nextFollowUpAt: scheduledDate },
      }),
    ]);

    return updated;
  }

  async escalate(id: string, escalatedToId: string, companyId: string) {
    const followUp = await this.prisma.followUp.findFirst({ where: { id, companyId } });
    if (!followUp) throw new NotFoundException('Follow-up not found');
    await this.assertUserInCompany(escalatedToId, companyId);

    return this.prisma.followUp.update({
      where: { id },
      data: { escalatedToId },
    });
  }

  async getMetrics(companyId: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const [todayCount, overdueCount, completedTodayCount] = await Promise.all([
      this.prisma.followUp.count({
        where: {
          companyId,
          scheduledDate: { gte: todayStart, lte: todayEnd },
          status: FollowUpStatus.PENDING,
        },
      }),
      this.prisma.followUp.count({
        where: {
          companyId,
          scheduledDate: { lt: todayStart },
          status: FollowUpStatus.PENDING,
        },
      }),
      this.prisma.followUp.count({
        where: { companyId, completedAt: { gte: todayStart, lte: todayEnd } },
      }),
    ]);

    return { todayCount, overdueCount, completedTodayCount };
  }
}
