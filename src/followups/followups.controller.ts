import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FollowUpsService } from './followups.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSION } from '../common/constants/permissions';

@ApiTags('Follow-ups')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('followups')
export class FollowUpsController {
  constructor(private readonly followUpsService: FollowUpsService) {}

  @Get()
  @RequirePermissions(
    PERMISSION.MANAGE_LEADS,
    PERMISSION.CALL_ASSIGNED_LEADS,
    PERMISSION.VIEW_MIS,
    PERMISSION.MONITOR_LIVE,
  )
  @ApiOperation({ summary: 'List follow-ups with filter (today, overdue, pending)' })
  findAll(@Query('type') type: 'today' | 'overdue' | 'pending', @CurrentUser() user: any) {
    const scopedUserId = user.roleName === 'TELECALLER' ? user.userId : undefined;
    return this.followUpsService.findAll({
      type,
      companyId: user.companyId,
      userId: scopedUserId,
    });
  }

  @Get('metrics')
  @RequirePermissions(
    PERMISSION.MANAGE_LEADS,
    PERMISSION.CALL_ASSIGNED_LEADS,
    PERMISSION.VIEW_MIS,
    PERMISSION.MONITOR_LIVE,
  )
  @ApiOperation({ summary: 'Summary counters for follow-ups (today, overdue, completed)' })
  getMetrics(@CurrentUser() user: any) {
    return this.followUpsService.getMetrics(user.companyId);
  }

  @Patch(':id/complete')
  @RequirePermissions(PERMISSION.MANAGE_LEADS, PERMISSION.CALL_ASSIGNED_LEADS, PERMISSION.SUBMIT_DISPOSITION)
  @ApiOperation({ summary: 'Mark follow-up as completed' })
  markComplete(
    @Param('id') id: string,
    @Body('remarks') remarks: string,
    @CurrentUser() user: any,
  ) {
    return this.followUpsService.markComplete(id, remarks, user.companyId);
  }

  @Patch(':id/reassign')
  @RequirePermissions(PERMISSION.ALLOCATE_LEADS, PERMISSION.MANAGE_LEADS)
  @ApiOperation({ summary: 'Reassign follow-up to another employee' })
  reassign(
    @Param('id') id: string,
    @Body('reassignedToId') reassignedToId: string,
    @CurrentUser() user: any,
  ) {
    return this.followUpsService.reassign(id, reassignedToId, user.companyId);
  }

  @Patch(':id/reschedule')
  @RequirePermissions(PERMISSION.MANAGE_LEADS, PERMISSION.CALL_ASSIGNED_LEADS, PERMISSION.SUBMIT_DISPOSITION)
  @ApiOperation({ summary: 'Reschedule follow-up date/time' })
  reschedule(
    @Param('id') id: string,
    @Body()
    body: { scheduledDate: string; scheduledTime?: string; remarks?: string },
    @CurrentUser() user: any,
  ) {
    return this.followUpsService.reschedule(id, user.companyId, body);
  }

  @Patch(':id/escalate')
  @RequirePermissions(PERMISSION.ALLOCATE_LEADS, PERMISSION.MANAGE_LEADS, PERMISSION.MONITOR_LIVE)
  @ApiOperation({ summary: 'Escalate overdue follow-up to manager' })
  escalate(
    @Param('id') id: string,
    @Body('escalatedToId') escalatedToId: string,
    @CurrentUser() user: any,
  ) {
    return this.followUpsService.escalate(id, escalatedToId, user.companyId);
  }
}
