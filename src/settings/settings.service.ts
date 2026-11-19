import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { clampListLimit } from '../common/utils/pagination';
import { ensureSystemRoles } from '../common/utils/ensure-system-roles';
import {
  CreateDispositionDto,
  UpdateCallingRulesDto,
} from './dto/settings.dto';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getCallingRules(companyId: string) {
    let rules = await this.prisma.callingRule.findFirst({ where: { companyId } });
    if (!rules) {
      rules = await this.prisma.callingRule.create({
        data: {
          name: 'Default Calling Rule',
          minGapBetweenCalls: 5,
          maxRetriesPerDay: 3,
          maxTotalRetries: 10,
          restrictedHoursStart: '20:00',
          restrictedHoursEnd: '09:00',
          waitTimeBetweenCalls: 5,
          companyId,
        },
      });
    }
    return rules;
  }

  async updateCallingRules(companyId: string, data: UpdateCallingRulesDto) {
    const rules = await this.getCallingRules(companyId);
    return this.prisma.callingRule.update({
      where: { id: rules.id },
      data,
    });
  }

  async getDispositions(companyId: string) {
    return this.prisma.dispositionMaster.findMany({
      where: { companyId },
      take: clampListLimit(),
      orderBy: { displayOrder: 'asc' },
    });
  }

  async createDisposition(data: CreateDispositionDto, companyId: string) {
    return this.prisma.dispositionMaster.create({
      data: { ...data, companyId },
    });
  }

  async getRoles(companyId: string) {
    await ensureSystemRoles(this.prisma, companyId);
    return this.prisma.role.findMany({
      where: { companyId },
      take: clampListLimit(),
      orderBy: { displayName: 'asc' },
      include: { _count: { select: { users: true } } },
    });
  }

  async updateRolePermissions(roleId: string, permissions: string[], companyId: string) {
    const result = await this.prisma.role.updateMany({
      where: { id: roleId, companyId },
      data: { permissions },
    });
    if (result.count === 0) {
      throw new NotFoundException('Role not found');
    }
    return this.prisma.role.findFirst({ where: { id: roleId, companyId } });
  }
}
