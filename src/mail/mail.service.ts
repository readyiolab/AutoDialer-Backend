import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    const host = process.env.SMTP_HOST;
    if (host) {
      const port = Number(process.env.SMTP_PORT || 587);
      const secure =
        process.env.SMTP_SECURE === 'true' ||
        process.env.SMTP_SECURE === '1' ||
        port === 465;
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: process.env.SMTP_USER
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            }
          : undefined,
      });
    }
  }

  isConfigured(): boolean {
    return !!this.transporter;
  }

  async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<{ sent: boolean; error?: string }> {
    if (!this.transporter) {
      this.logger.warn(`SMTP not configured. Skipping email to ${options.to}: ${options.subject}`);
      return { sent: false, error: 'SMTP not configured' };
    }

    try {
      await this.transporter.sendMail({
        from:
          process.env.SMTP_FROM ||
          process.env.EMAIL_FROM ||
          process.env.SMTP_USER ||
          'noreply@autodial.local',
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      return { sent: true };
    } catch (err: any) {
      this.logger.error(`Failed to send email to ${options.to}: ${err.message}`);
      return { sent: false, error: err.message };
    }
  }

  async sendInvitationEmail(params: {
    to: string;
    name: string;
    companyName: string;
    inviteUrl: string;
  }) {
    const html = `
      <h2>Welcome to AutoDial Pro</h2>
      <p>Hello ${params.name},</p>
      <p>Your account for <strong>${params.companyName}</strong> has been created.</p>
      <p>Click the link below to set your password. This link expires in 48 hours.</p>
      <p><a href="${params.inviteUrl}">Set up your password</a></p>
      <p>If you did not expect this email, ignore it.</p>
    `;
    return this.sendMail({
      to: params.to,
      subject: `Activate your AutoDial Pro account — ${params.companyName}`,
      html,
      text: `Set your password: ${params.inviteUrl}`,
    });
  }
}
