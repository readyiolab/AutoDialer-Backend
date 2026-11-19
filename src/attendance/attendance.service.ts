import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { clampListLimit } from '../common/utils/pagination';

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService) {}

  async markLogin(userId: string, companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let log = await this.prisma.attendanceLog.findFirst({
      where: { userId, companyId, date: today },
    });

    if (!log) {
      log = await this.prisma.attendanceLog.create({
        data: {
          userId,
          companyId,
          date: today,
          loginTime: new Date(),
        },
      });
    }

    return log;
  }

  async markLogout(userId: string, companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const log = await this.prisma.attendanceLog.findFirst({
      where: { userId, companyId, date: today },
    });

    if (!log) throw new NotFoundException('Attendance log for today not found');

    const logoutTime = new Date();
    const totalDuration = Math.round(
      (logoutTime.getTime() - new Date(log.loginTime).getTime()) / 60000,
    );

    return this.prisma.attendanceLog.update({
      where: { id: log.id },
      data: {
        logoutTime,
        totalDuration,
      },
    });
  }

  async startBreak(userId: string, companyId: string, reason?: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const log = await this.prisma.attendanceLog.findFirst({
      where: { userId, companyId, date: today },
    });

    if (!log) throw new NotFoundException('Attendance log for today not found');

    return this.prisma.breakLog.create({
      data: {
        attendanceId: log.id,
        startTime: new Date(),
        reason,
      },
    });
  }

  async endBreak(userId: string, companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const log = await this.prisma.attendanceLog.findFirst({
      where: { userId, companyId, date: today },
      include: {
        breaks: {
          where: { endTime: null },
          orderBy: { startTime: 'desc' },
          take: 1,
        },
      },
    });

    if (!log || !log.breaks.length) throw new NotFoundException('Active break not found');

    const activeBreak = log.breaks[0];
    const endTime = new Date();
    const duration = Math.round(
      (endTime.getTime() - new Date(activeBreak.startTime).getTime()) / 60000,
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.breakLog.update({
        where: { id: activeBreak.id },
        data: { endTime, duration },
      });

      return tx.attendanceLog.update({
        where: { id: log.id },
        data: {
          breakDuration: { increment: duration },
        },
      });
    });
  }

  async getAttendance(companyId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);

    return this.prisma.attendanceLog.findMany({
      where: { companyId, date: targetDate },
      take: clampListLimit(),
      include: {
        user: { select: { id: true, name: true, employeeId: true, phone: true } },
        breaks: true,
      },
      orderBy: { loginTime: 'desc' },
    });
  }
}
