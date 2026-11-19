import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async process(job: Job) {
    const data = job.data as {
      userId: string;
      companyId: string;
      title: string;
      body: string;
      type: string;
      email?: string;
      sendEmail?: boolean;
      metadata?: Record<string, unknown>;
    };

    await this.prisma.notification.create({
      data: {
        userId: data.userId,
        companyId: data.companyId,
        title: data.title,
        body: data.body,
        type: data.type,
        channel: 'IN_APP',
        metadata: (data.metadata as any) || {},
      },
    });

    if (data.sendEmail && data.email) {
      await this.mail.sendMail({
        to: data.email,
        subject: data.title,
        html: `<p>${data.body}</p>`,
        text: data.body,
      });
    }

    this.logger.debug(`Notification sent to ${data.userId}: ${data.type}`);
    return { ok: true };
  }
}
