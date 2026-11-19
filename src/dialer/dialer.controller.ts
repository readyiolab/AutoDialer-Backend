import { Controller, Post, Get, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DialMode } from '@prisma/client';
import { DialerService } from './dialer.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSION } from '../common/constants/permissions';

@ApiTags('Dialer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dialer')
export class DialerController {
  constructor(private readonly dialerService: DialerService) {}

  @Post('sessions')
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiOperation({ summary: 'Start a phone autodialer session (requires campaignId)' })
  start(
    @CurrentUser() user: any,
    @Body() body: { campaignId?: string; mode?: DialMode; forceNew?: boolean },
  ) {
    return this.dialerService.startSession(user.userId, user.companyId, body || {});
  }

  @Get('sessions/active')
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiOperation({
    summary: 'Get active RUNNING/PAUSED dialer session (optional campaignId filter)',
  })
  active(@CurrentUser() user: any, @Query('campaignId') campaignId?: string) {
    return this.dialerService.getActiveSession(user.userId, user.companyId, campaignId);
  }

  @Get('sessions/active/list')
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiOperation({ summary: 'List all RUNNING/PAUSED dialer sessions for the user' })
  listActive(@CurrentUser() user: any) {
    return this.dialerService.listActiveSessions(user.userId, user.companyId);
  }

  @Post('sessions/:id/pause')
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  pause(@Param('id') id: string, @CurrentUser() user: any) {
    return this.dialerService.pauseSession(id, user.userId, user.companyId);
  }

  @Post('sessions/:id/resume')
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  resume(@Param('id') id: string, @CurrentUser() user: any) {
    return this.dialerService.resumeSession(id, user.userId, user.companyId);
  }

  @Post('sessions/:id/end')
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  end(@Param('id') id: string, @CurrentUser() user: any) {
    return this.dialerService.endSession(id, user.userId, user.companyId);
  }

  @Post('sessions/:id/events')
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  event(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body()
    body: {
      type: 'started' | 'ended' | 'skip';
      leadId?: string;
      duration?: number;
      disposition?: string;
      remarks?: string;
      followUpDate?: string;
      followUpTime?: string;
    },
  ) {
    return this.dialerService.handleEvent(id, user.userId, user.companyId, body);
  }

  @Get('sessions/:id/next')
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  next(@Param('id') id: string, @CurrentUser() user: any) {
    return this.dialerService.getNext(id, user.userId, user.companyId);
  }
}
