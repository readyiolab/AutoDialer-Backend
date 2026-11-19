import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('login')
  @ApiOperation({ summary: 'Record telecaller daily shift login' })
  markLogin(@CurrentUser() user: any) {
    return this.attendanceService.markLogin(user.userId, user.companyId);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Record telecaller daily shift logout' })
  markLogout(@CurrentUser() user: any) {
    return this.attendanceService.markLogout(user.userId, user.companyId);
  }

  @Post('break/start')
  @ApiOperation({ summary: 'Start calling break (Tea, Lunch, Training)' })
  startBreak(@Body('reason') reason: string, @CurrentUser() user: any) {
    return this.attendanceService.startBreak(user.userId, user.companyId, reason);
  }

  @Post('break/end')
  @ApiOperation({ summary: 'End break and resume availability' })
  endBreak(@CurrentUser() user: any) {
    return this.attendanceService.endBreak(user.userId, user.companyId);
  }

  @Get()
  @ApiOperation({ summary: 'Get employee attendance logs' })
  getAttendance(@Query('date') date: string, @CurrentUser() user: any) {
    return this.attendanceService.getAttendance(user.companyId, date);
  }
}
