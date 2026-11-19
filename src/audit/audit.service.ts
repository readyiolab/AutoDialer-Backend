import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { clampPage, clampPageSize } from '../common/utils/pagination';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async logAction(data: {
    userId?: string;
    action: string;
    entity: string;
    entityId?: string;
    oldValues?: any;
    newValues?: any;
    ipAddress?: string;
    companyId: string;
  }) {
    return this.prisma.auditLog.create({ data });
  }

  async getLogs(params: {
    entity?: string;
    action?: string;
    userId?: string;
    companyId: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = clampPage(params.page);
    const pageSize = clampPageSize(params.pageSize, 30);
    const skip = (page - 1) * pageSize;
    const { entity, action, userId, companyId } = params;

    const where: any = { companyId };
    if (entity) where.entity = entity;
    if (action) where.action = action;
    if (userId) where.userId = userId;

    const [total, data] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, employeeId: true } } },
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
