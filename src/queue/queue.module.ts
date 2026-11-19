import { Global, Module, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { ImportProcessor } from './import.processor';
import { NotificationProcessor } from './notification.processor';

export const LEAD_IMPORT_QUEUE = 'lead-import';
export const NOTIFICATION_QUEUE = 'notifications';

@Global()
@Module({
  providers: [ImportProcessor, NotificationProcessor],
  exports: [ImportProcessor, NotificationProcessor],
})
export class QueueModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueModule.name);
  private connection: IORedis | null = null;
  static importQueue: Queue | null = null;
  static notificationQueue: Queue | null = null;
  private workers: Worker[] = [];

  constructor(
    private readonly importProcessor: ImportProcessor,
    private readonly notificationProcessor: NotificationProcessor,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set — background jobs run inline');
      return;
    }

    try {
      this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      QueueModule.importQueue = new Queue(LEAD_IMPORT_QUEUE, { connection: this.connection });
      QueueModule.notificationQueue = new Queue(NOTIFICATION_QUEUE, {
        connection: this.connection,
      });

      this.workers.push(
        new Worker(
          LEAD_IMPORT_QUEUE,
          async (job: Job) => this.importProcessor.process(job),
          { connection: this.connection },
        ),
        new Worker(
          NOTIFICATION_QUEUE,
          async (job: Job) => this.notificationProcessor.process(job),
          { connection: this.connection },
        ),
      );

      this.logger.log('BullMQ queues connected');
    } catch (err: any) {
      this.logger.error(`Redis/BullMQ init failed: ${err.message}. Jobs will run inline.`);
      QueueModule.importQueue = null;
      QueueModule.notificationQueue = null;
    }
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
    await QueueModule.importQueue?.close();
    await QueueModule.notificationQueue?.close();
    await this.connection?.quit();
  }

  static async enqueueImport(data: { importHistoryId: string; companyId: string }) {
    if (QueueModule.importQueue) {
      await QueueModule.importQueue.add('commit-import', data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      });
      return { queued: true };
    }
    return { queued: false };
  }

  static async enqueueNotification(data: Record<string, unknown>, delayMs = 0) {
    if (QueueModule.notificationQueue) {
      await QueueModule.notificationQueue.add('notify', data, {
        delay: delayMs,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });
      return { queued: true };
    }
    return { queued: false };
  }
}
