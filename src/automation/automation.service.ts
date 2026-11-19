import { Injectable, NotFoundException, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueModule } from '../queue/queue.module';

const DEFAULT_RULES = [
  {
    code: 'FOLLOWUP_OVERDUE',
    name: 'Mark overdue follow-ups',
    description: 'Follow-ups past scheduled time become OVERDUE and notify the owner',
    condition: { type: 'FOLLOWUP_PAST_DUE' },
    action: { type: 'MARK_OVERDUE_AND_NOTIFY' },
    priority: 10,
  },
  {
    code: 'IDLE_NEEDS_REVIEW',
    name: 'Flag idle leads after 2 days',
    description: 'Assigned leads with no update for 2 days flagged for manager review',
    condition: { type: 'IDLE_DAYS', days: 2 },
    action: { type: 'SET_NEEDS_REVIEW' },
    priority: 20,
  },
  {
    code: 'UNANSWERED_STREAK',
    name: 'Flag after 3 unanswered attempts',
    description: 'Leads with 3+ attempts and 0 connects need reassignment review',
    condition: { type: 'UNANSWERED_MIN', min: 3 },
    action: { type: 'SET_NEEDS_REVIEW' },
    priority: 30,
  },
  {
    code: 'INACTIVE_ASSIGNEE',
    name: 'Inactive telecaller queue',
    description: 'Leads assigned to inactive users flagged for reassignment',
    condition: { type: 'INACTIVE_ASSIGNEE' },
    action: { type: 'SET_NEEDS_REVIEW' },
    priority: 40,
  },
];

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    // Run every 5 minutes in-process; also enqueueable via BullMQ when Redis is up
    this.timer = setInterval(() => {
      this.runAllCompanies().catch((e) => this.logger.error(e.message));
    }, 5 * 60_000);
    setTimeout(() => {
      this.runAllCompanies().catch((e) => this.logger.error(e.message));
    }, 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async ensureDefaultRules(companyId: string) {
    for (const rule of DEFAULT_RULES) {
      await this.prisma.automationRule.upsert({
        where: { companyId_code: { companyId, code: rule.code } },
        create: { companyId, ...rule, isActive: true },
        update: {},
      });
    }
  }

  async listRules(companyId: string) {
    await this.ensureDefaultRules(companyId);
    return this.prisma.automationRule.findMany({
      where: { companyId },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    });
  }

  async updateRule(
    id: string,
    companyId: string,
    data: { isActive?: boolean; name?: string; description?: string; condition?: any; action?: any; priority?: number },
  ) {
    const existing = await this.prisma.automationRule.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Rule not found');
    return this.prisma.automationRule.update({ where: { id }, data });
  }

  async runAllCompanies() {
    const companies = await this.prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
      take: 200,
    });
    for (const c of companies) {
      await this.ensureDefaultRules(c.id);
      await this.runCompany(c.id);
    }
  }

  async runCompany(companyId: string) {
    const rules = await this.prisma.automationRule.findMany({
      where: { companyId, isActive: true },
      orderBy: { priority: 'asc' },
    });
    const summary: Record<string, number> = {};
    for (const rule of rules) {
      const cond = rule.condition as any;
      const action = rule.action as any;
      if (cond?.type === 'FOLLOWUP_PAST_DUE' && action?.type === 'MARK_OVERDUE_AND_NOTIFY') {
        summary[rule.code] = await this.markOverdueFollowUps(companyId);
      } else if (cond?.type === 'IDLE_DAYS' && action?.type === 'SET_NEEDS_REVIEW') {
        summary[rule.code] = await this.flagIdle(companyId, Number(cond.days || 2));
      } else if (cond?.type === 'UNANSWERED_MIN' && action?.type === 'SET_NEEDS_REVIEW') {
        summary[rule.code] = await this.flagUnanswered(companyId, Number(cond.min || 3));
      } else if (cond?.type === 'INACTIVE_ASSIGNEE' && action?.type === 'SET_NEEDS_REVIEW') {
        summary[rule.code] = await this.flagInactiveAssignees(companyId);
      }
    }
    return summary;
  }

  private async markOverdueFollowUps(companyId: string) {
    const now = new Date();
    const due = await this.prisma.followUp.findMany({
      where: {
        companyId,
        status: 'PENDING',
        scheduledDate: { lt: now },
      },
      select: { id: true, userId: true, leadId: true },
      take: 500,
    });
    if (!due.length) return 0;

    await this.prisma.followUp.updateMany({
      where: { id: { in: due.map((d) => d.id) } },
      data: { status: 'OVERDUE' },
    });

    const byUser = new Map<string, number>();
    for (const d of due) {
      byUser.set(d.userId, (byUser.get(d.userId) || 0) + 1);
    }
    for (const [userId, count] of byUser) {
      const dedupeKey = `fu-overdue-${userId}-${now.toISOString().slice(0, 10)}`;
      const existing = await this.prisma.notification.findFirst({
        where: {
          userId,
          companyId,
          type: 'FOLLOWUP_OVERDUE',
          createdAt: { gte: new Date(now.toDateString()) },
        },
      });
      if (existing) continue;
      await this.notifications.notify({
        userId,
        companyId,
        title: 'Overdue follow-ups',
        body: `You have ${count} overdue follow-up(s)`,
        type: 'FOLLOWUP_OVERDUE',
        metadata: { count, dedupeKey },
      });
    }
    return due.length;
  }

  private async flagIdle(companyId: string, days: number) {
    const since = new Date(Date.now() - days * 86400000);
    const result = await this.prisma.lead.updateMany({
      where: {
        companyId,
        assignedToId: { not: null },
        needsReview: false,
        status: { in: ['ASSIGNED', 'PENDING', 'NOT_CONTACTED', 'NEW'] },
        OR: [
          { lastContactedAt: { lt: since } },
          { AND: [{ lastContactedAt: null }, { updatedAt: { lt: since } }] },
        ],
      },
      data: { needsReview: true },
    });
    return result.count;
  }

  private async flagUnanswered(companyId: string, min: number) {
    const result = await this.prisma.lead.updateMany({
      where: {
        companyId,
        assignedToId: { not: null },
        needsReview: false,
        totalAttempts: { gte: min },
        connectedCalls: 0,
        status: { notIn: ['CONVERTED', 'CLOSED', 'DND'] },
      },
      data: { needsReview: true },
    });
    return result.count;
  }

  private async flagInactiveAssignees(companyId: string) {
    const result = await this.prisma.lead.updateMany({
      where: {
        companyId,
        needsReview: false,
        assignedTo: { status: { not: 'ACTIVE' } },
      },
      data: { needsReview: true },
    });
    return result.count;
  }

  async enqueueRun(companyId: string) {
    const queued = await QueueModule.enqueueNotification({
      kind: 'AUTOMATION_RUN',
      companyId,
    });
    if (!queued.queued) {
      return this.runCompany(companyId);
    }
    return { queued: true };
  }
}
