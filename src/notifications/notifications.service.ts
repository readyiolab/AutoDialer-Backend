import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueueModule } from '../queue/queue.module';
import { clampPage, clampPageSize } from '../common/utils/pagination';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(params: {
    userId: string;
    companyId: string;
    title: string;
    body: string;
    type: string;
    email?: string;
    sendEmail?: boolean;
    metadata?: Record<string, unknown>;
    delayMs?: number;
  }) {
    const queued = await QueueModule.enqueueNotification(params, params.delayMs || 0);
    if (!queued.queued) {
      await this.prisma.notification.create({
        data: {
          userId: params.userId,
          companyId: params.companyId,
          title: params.title,
          body: params.body,
          type: params.type,
          channel: 'IN_APP',
          metadata: (params.metadata as any) || {},
        },
      });
    }
    return { ok: true };
  }

  async listForUser(userId: string, companyId: string, page = 1, pageSize = 20) {
    const p = clampPage(page);
    const ps = clampPageSize(pageSize);
    const where = { userId, companyId };
    const [data, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...where, isRead: false } }),
    ]);
    return { data, meta: { total, page: p, pageSize: ps, unread } };
  }

  async markRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: string, companyId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, companyId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }
}
