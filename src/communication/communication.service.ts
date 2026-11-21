import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto, SendMessageDto } from './dto/communication.dto';
import { MessageStatus, MessageType } from '@prisma/client';
import { clampPage, clampPageSize, clampListLimit } from '../common/utils/pagination';
import {
  renderMessageTemplate,
  templateCampaignMatchScore,
  TemplateRenderVars,
} from './template-render.util';

@Injectable()
export class CommunicationService {
  constructor(private prisma: PrismaService) {}

  renderTemplate(content: string, vars: TemplateRenderVars) {
    return renderMessageTemplate(content, vars);
  }

  /** Brand WhatsApp templates used when sharing UTM on Interested. */
  static readonly BRAND_SHARE_TEMPLATES: Array<{
    name: string;
    category: string;
    content: string;
  }> = [
    {
      name: 'Lmendigo',
      category: 'Lmendigo',
      content: [
        'Hello! Welcome to Lmendigo.',
        '',
        'To apply for a short-term loan, please complete your fresh application using the link below and keep these documents ready:',
        '',
        '1. PAN Card',
        '2. Aadhaar Card',
        '3. Latest 6 Months Bank Statement',
        '4. Last 2 Months Salary Slips',
        '',
        'Apply Now: {link}',
        '',
        'Our team will verify your application and guide you through the next steps.',
      ].join('\n'),
    },
    {
      name: 'InstantRupiya',
      category: 'InstantRupiya',
      content: [
        'Hello! Welcome to InstantRupiya.',
        '',
        'To apply for a short-term loan, please complete your fresh application using the link below and keep these documents ready:',
        '',
        '1. PAN Card',
        '2. Aadhaar Card',
        '3. Latest 6 Months Bank Statement',
        '4. Last 2 Months Salary Slips',
        '',
        'Apply Now: {link}',
        '',
        'Our team will verify your application and guide you through the next steps.',
      ].join('\n'),
    },
  ];

  async ensureBrandShareTemplates(companyId: string) {
    for (const t of CommunicationService.BRAND_SHARE_TEMPLATES) {
      await this.prisma.messageTemplate.upsert({
        where: { name_companyId: { name: t.name, companyId } },
        update: {},
        create: {
          name: t.name,
          category: t.category,
          content: t.content,
          type: MessageType.WHATSAPP,
          variables: ['customerName', 'link'],
          isApproved: true,
          companyId,
        },
      });
    }
  }

  /**
   * Approved templates for mobile share, with placeholders filled and optional campaign preference.
   */
  async getShareTemplates(opts: {
    companyId: string;
    shareLink?: string | null;
    customerName?: string | null;
    campaignName?: string | null;
    type?: MessageType;
    /** When set and non-empty, only these templates (still must be approved). */
    templateIds?: string[] | null;
  }) {
    await this.ensureBrandShareTemplates(opts.companyId);

    const where: any = { companyId: opts.companyId, isApproved: true };
    if (opts.type) where.type = opts.type;
    if (opts.templateIds?.length) {
      where.id = { in: opts.templateIds };
    }

    const rows = await this.prisma.messageTemplate.findMany({
      where,
      take: clampListLimit(),
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        category: true,
        type: true,
        content: true,
      },
    });

    const vars: TemplateRenderVars = {
      link: opts.shareLink,
      utm: opts.shareLink,
      customerName: opts.customerName,
    };

    const scored = rows.map((row) => ({
      ...row,
      content: renderMessageTemplate(row.content, vars),
      matchScore: templateCampaignMatchScore(
        opts.campaignName,
        row.name,
        row.category,
      ),
    }));

    scored.sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      return a.name.localeCompare(b.name);
    });

    const preferredTemplateId =
      scored.find((t) => t.matchScore > 0)?.id || scored[0]?.id || null;

    return {
      templates: scored.map(({ matchScore: _s, ...t }) => t),
      preferredTemplateId,
    };
  }

  async createTemplate(dto: CreateTemplateDto, companyId: string) {
    return this.prisma.messageTemplate.create({
      data: {
        ...dto,
        companyId,
      },
    });
  }

  async getTemplates(companyId: string, type?: any) {
    const where: any = { companyId };
    if (type) where.type = type;
    return this.prisma.messageTemplate.findMany({
      where,
      take: clampListLimit(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateTemplate(id: string, dto: Partial<CreateTemplateDto>, companyId: string) {
    const t = await this.prisma.messageTemplate.findFirst({ where: { id, companyId } });
    if (!t) throw new NotFoundException('Template not found');

    return this.prisma.messageTemplate.update({
      where: { id },
      data: dto,
    });
  }

  async sendMessage(dto: SendMessageDto, userId: string, companyId: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: dto.leadId, companyId },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    let content = dto.content;
    if (dto.templateId && !content?.trim()) {
      const template = await this.prisma.messageTemplate.findFirst({
        where: { id: dto.templateId, companyId },
      });
      if (template) {
        const user = await this.prisma.user.findFirst({
          where: { id: userId, companyId },
          select: { shareLink: true },
        });
        content = renderMessageTemplate(template.content, {
          link: user?.shareLink,
          customerName: lead.customerName,
        });
      }
    }

    const log = await this.prisma.communicationLog.create({
      data: {
        leadId: dto.leadId,
        userId,
        type: dto.type,
        templateId: dto.templateId,
        content,
        status: MessageStatus.DELIVERED,
        sentAt: new Date(),
        deliveredAt: new Date(),
        companyId,
      },
      include: {
        template: { select: { name: true } },
      },
    });

    return { success: true, log };
  }

  async getHistory(params: {
    leadId?: string;
    userId?: string;
    type?: any;
    companyId: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = clampPage(params.page);
    const pageSize = clampPageSize(params.pageSize);
    const skip = (page - 1) * pageSize;
    const { leadId, userId, type, companyId } = params;

    const where: any = { companyId };
    if (leadId) where.leadId = leadId;
    if (userId) where.userId = userId;
    if (type) where.type = type;

    const [total, data] = await Promise.all([
      this.prisma.communicationLog.count({ where }),
      this.prisma.communicationLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          lead: { select: { customerName: true, mobileNumber: true } },
          user: { select: { name: true, employeeId: true } },
          template: { select: { name: true } },
        },
      }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
