import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto, SendMessageDto } from './dto/communication.dto';
import { MessageStatus } from '@prisma/client';
import { clampPage, clampPageSize, clampListLimit } from '../common/utils/pagination';

@Injectable()
export class CommunicationService {
  constructor(private prisma: PrismaService) {}

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

    const log = await this.prisma.communicationLog.create({
      data: {
        leadId: dto.leadId,
        userId,
        type: dto.type,
        templateId: dto.templateId,
        content: dto.content,
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
