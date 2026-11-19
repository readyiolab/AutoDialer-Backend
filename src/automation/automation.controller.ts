import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSION } from '../common/constants/permissions';
import { AutomationService } from './automation.service';

@ApiTags('Automation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get('rules')
  @RequirePermissions(PERMISSION.MANAGE_SETTINGS, PERMISSION.MANAGE_LEADS)
  @ApiOperation({ summary: 'List automation rules for company' })
  list(@CurrentUser() user: any) {
    return this.automation.listRules(user.companyId);
  }

  @Patch('rules/:id')
  @RequirePermissions(PERMISSION.MANAGE_SETTINGS)
  update(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.automation.updateRule(id, user.companyId, body);
  }

  @Post('run')
  @RequirePermissions(PERMISSION.MANAGE_SETTINGS, PERMISSION.MANAGE_LEADS)
  @ApiOperation({ summary: 'Run automation rules now' })
  run(@CurrentUser() user: any) {
    return this.automation.runCompany(user.companyId);
  }
}
