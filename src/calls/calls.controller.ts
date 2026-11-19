import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CallsService } from './calls.service';
import { CreateCallDto } from './dto/create-call.dto';
import { SubmitDispositionDto } from './dto/disposition.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSION } from '../common/constants/permissions';

@ApiTags('Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Post()
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS, PERMISSION.SUBMIT_DISPOSITION)
  @ApiOperation({ summary: 'Record phone call start/end event from mobile dialler' })
  recordCall(@Body() dto: CreateCallDto, @CurrentUser() user: any) {
    return this.callsService.recordCall(dto, user.userId, user.companyId);
  }

  @Post(':id/disposition')
  @RequirePermissions(PERMISSION.SUBMIT_DISPOSITION)
  @ApiOperation({ summary: 'Submit call outcome / disposition' })
  submitDisposition(
    @Param('id') id: string,
    @Body() dto: SubmitDispositionDto,
    @CurrentUser() user: any,
  ) {
    return this.callsService.submitDisposition(id, dto, user.userId, user.companyId);
  }

  @Get('history')
  @RequirePermissions(
    PERMISSION.CALL_ASSIGNED_LEADS,
    PERMISSION.VIEW_MIS,
    PERMISSION.MONITOR_LIVE,
  )
  @ApiOperation({ summary: 'Get filtered call history log' })
  getHistory(@Query() query: any, @CurrentUser() user: any) {
    const filters = { ...query, companyId: user.companyId };
    if (user.roleName === 'TELECALLER') filters.userId = user.userId;
    return this.callsService.getHistory(filters);
  }

  @Get('live')
  @RequirePermissions(PERMISSION.MONITOR_LIVE, PERMISSION.VIEW_MIS)
  @ApiOperation({ summary: 'Live telecaller calling activity monitor' })
  getLiveActivity(@CurrentUser() user: any) {
    return this.callsService.getLiveActivity(user.companyId);
  }

  @Get('queue')
  @RequirePermissions(PERMISSION.CALL_ASSIGNED_LEADS)
  @ApiOperation({ summary: 'Get next prioritized lead in calling queue for telecaller' })
  getNextInQueue(@CurrentUser() user: any) {
    return this.callsService.getNextLeadInQueue(user.userId, user.companyId);
  }
}
