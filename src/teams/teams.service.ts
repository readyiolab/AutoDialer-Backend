import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { clampPage, clampPageSize } from '../common/utils/pagination';

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(companyId: string, pagination: { page?: number; pageSize?: number } = {}) {
    const page = clampPage(pagination.page);
    const pageSize = clampPageSize(pagination.pageSize);
    const where = { companyId };
    const [data, total] = await Promise.all([
      this.prisma.team.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          manager: { select: { id: true, name: true, employeeId: true } },
          _count: { select: { users: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.team.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async create(
    companyId: string,
    data: { name: string; managerId?: string },
    performedById: string,
  ) {
    try {
      const team = await this.prisma.team.create({
        data: {
          name: data.name,
          companyId,
          managerId: data.managerId || null,
        },
      });
      await this.audit.logAction({
        userId: performedById,
        action: 'TEAM_CREATE',
        entity: 'Team',
        entityId: team.id,
        companyId,
        newValues: data,
      });
      return team;
    } catch {
      throw new ConflictException('Team name already exists');
    }
  }

  async update(
    id: string,
    companyId: string,
    data: { name?: string; managerId?: string; isActive?: boolean },
    performedById: string,
  ) {
    const existing = await this.prisma.team.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Team not found');

    const team = await this.prisma.team.update({
      where: { id },
      data,
    });

    await this.audit.logAction({
      userId: performedById,
      action: 'TEAM_UPDATE',
      entity: 'Team',
      entityId: id,
      companyId,
      newValues: data,
    });

    return team;
  }
}
