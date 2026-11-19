import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DialMode } from '@prisma/client';
import { MobileService } from './mobile.service';
import { LoginDto } from '../auth/dto/login.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TelecallerGuard } from '../auth/telecaller.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSION } from '../common/constants/permissions';

@ApiTags('Mobile Telecaller')
@Controller('mobile')
export class MobileController {
  constructor(private readonly mobile: MobileService) {}

  @Post('auth/login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Telecaller-only Android login' })
  login(@Body() dto: LoginDto) {
    return this.mobile.login({ ...dto, clientType: 'android' });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, TelecallerGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: any) {
    return this.mobile.me(user.userId);
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  dashboard(@CurrentUser() user: any) {
    return this.mobile.dashboard(user.userId, user.companyId);
  }

  @Get('today')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  today(@CurrentUser() user: any) {
    return this.mobile.todayHome(user.userId, user.companyId);
  }

  @Get('lists')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  lists(@CurrentUser() user: any) {
    return this.mobile.listCampaigns(user.userId, user.companyId);
  }

  @Get('lists/:id')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  listDetail(@Param('id') id: string, @CurrentUser() user: any, @Query() query: any) {
    return this.mobile.listCampaignDetail(id, user.userId, user.companyId, query || {});
  }

  @Get('inbox')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  inbox(@CurrentUser() user: any, @Query() query: any) {
    return this.mobile.inboxLeads(user.userId, user.companyId, query || {});
  }

  @Get('leads')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  leads(@CurrentUser() user: any, @Query() query: any) {
    return this.mobile.listLeads(user.userId, user.companyId, query);
  }

  @Get('leads/:id')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  lead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.mobile.getLead(id, user.userId, user.companyId);
  }

  @Post('dialer/sessions')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start dialer session (requires campaignId)' })
  startSession(
    @CurrentUser() user: any,
    @Body() body: { campaignId?: string; mode?: DialMode; forceNew?: boolean },
  ) {
    return this.mobile.startSession(user.userId, user.companyId, body || {});
  }

  @Get('dialer/sessions/active')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active session (optional campaignId filter)' })
  activeSession(@CurrentUser() user: any, @Query('campaignId') campaignId?: string) {
    return this.mobile.getActiveSession(user.userId, user.companyId, campaignId);
  }

  @Get('dialer/sessions/active/list')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all active dialer sessions for the telecaller' })
  listActiveSessions(@CurrentUser() user: any) {
    return this.mobile.listActiveSessions(user.userId, user.companyId);
  }

  @Post('dialer/sessions/:id/events')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  event(@Param('id') id: string, @CurrentUser() user: any, @Body() body: any) {
    return this.mobile.dialerEvent(id, user.userId, user.companyId, body);
  }

  @Post('dialer/sessions/:id/pause')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  pause(@Param('id') id: string, @CurrentUser() user: any) {
    return this.mobile.pauseSession(id, user.userId, user.companyId);
  }

  @Post('dialer/sessions/:id/resume')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  resume(@Param('id') id: string, @CurrentUser() user: any) {
    return this.mobile.resumeSession(id, user.userId, user.companyId);
  }

  @Post('dialer/sessions/:id/end')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  end(@Param('id') id: string, @CurrentUser() user: any) {
    return this.mobile.endSession(id, user.userId, user.companyId);
  }

  @Get('dialer/sessions/:id/next')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  next(@Param('id') id: string, @CurrentUser() user: any) {
    return this.mobile.nextLead(id, user.userId, user.companyId);
  }

  @Post('calls/:id/disposition')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.SUBMIT_DISPOSITION)
  @ApiBearerAuth()
  disposition(@Param('id') id: string, @CurrentUser() user: any, @Body() body: any) {
    return this.mobile.submitDisposition(id, user.userId, user.companyId, body);
  }

  @Get('followups')
  @UseGuards(JwtAuthGuard, TelecallerGuard)
  @ApiBearerAuth()
  followups(@CurrentUser() user: any, @Query('type') type?: string) {
    return this.mobile.followUps(user.userId, user.companyId, type);
  }

  @Get('performance')
  @UseGuards(JwtAuthGuard, TelecallerGuard)
  @ApiBearerAuth()
  performance(
    @CurrentUser() user: any,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.mobile.performance(user.userId, user.companyId, dateFrom, dateTo);
  }

  @Get('call-history')
  @UseGuards(JwtAuthGuard, TelecallerGuard)
  @ApiBearerAuth()
  history(@CurrentUser() user: any, @Query() query: any) {
    return this.mobile.callHistory(user.userId, user.companyId, query);
  }

  @Get('notifications')
  @UseGuards(JwtAuthGuard, TelecallerGuard)
  @ApiBearerAuth()
  notifications(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.mobile.notifications(
      user.userId,
      user.companyId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
  }

  @Post('notifications/:id/read')
  @UseGuards(JwtAuthGuard, TelecallerGuard)
  @ApiBearerAuth()
  markRead(@Param('id') id: string, @CurrentUser() user: any) {
    return this.mobile.markNotificationRead(id, user.userId);
  }

  @Post('devices')
  @UseGuards(JwtAuthGuard, TelecallerGuard)
  @ApiBearerAuth()
  devices(
    @CurrentUser() user: any,
    @Body()
    body: {
      deviceId: string;
      fcmToken?: string;
      publicKey?: string;
      model?: string;
      androidVersion?: string;
      appVersion?: string;
      riskFlags?: string[];
    },
  ) {
    return this.mobile.registerDevice(user.userId, user.companyId, body);
  }

  @Post('security/screenshot-attempt')
  @UseGuards(JwtAuthGuard, TelecallerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log screenshot / screen-capture attempt (API 34+)' })
  screenshotAttempt(
    @CurrentUser() user: any,
    @Body() body: { deviceId?: string },
  ) {
    return this.mobile.reportScreenshot(user.userId, user.companyId, body?.deviceId || user.deviceId);
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  sync(
    @CurrentUser() user: any,
    @Body() body: { events: Array<{ idempotencyKey: string; type: string; payload: any }> },
  ) {
    return this.mobile.syncBatch(user.userId, user.companyId, body.events || []);
  }

  @Get('share-link')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get telecaller UTM/share link + default WhatsApp message' })
  shareLink(@CurrentUser() user: any, @Query('leadId') leadId?: string) {
    return this.mobile.getShareLink(user.userId, user.companyId, leadId);
  }

  @Post('share-log')
  @UseGuards(JwtAuthGuard, TelecallerGuard, PermissionsGuard)
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log WhatsApp/SMS share opened from Android' })
  shareLog(
    @CurrentUser() user: any,
    @Body() body: { leadId: string; type: 'WHATSAPP' | 'SMS'; content: string },
  ) {
    return this.mobile.logShare(user.userId, user.companyId, body);
  }
}
