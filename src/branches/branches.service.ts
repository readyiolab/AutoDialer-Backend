import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { clampListLimit } from '../common/utils/pagination';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string) {
    return this.prisma.branch.findMany({
      where: { companyId },
      take: clampListLimit(),
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
  }

  async create(data: CreateBranchDto, companyId: string) {
    return this.prisma.branch.create({
      data: { ...data, companyId },
    });
  }

  async update(id: string, data: UpdateBranchDto, companyId: string) {
    const b = await this.prisma.branch.findFirst({ where: { id, companyId } });
    if (!b) throw new NotFoundException('Branch not found');
    return this.prisma.branch.update({ where: { id }, data });
  }
}
