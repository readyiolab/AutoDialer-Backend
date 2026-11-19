import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ADMIN_MUTATION_ROLES } from '../common/constants/roles';
import {
  CreateDispositionDto,
  UpdateCallingRulesDto,
  UpdateRolePermissionsDto,
} from './dto/settings.dto';

@ApiTags('Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('calling-rules')
  @ApiOperation({ summary: 'Get auto-dialler and retry rules' })
  getCallingRules(@CurrentUser() user: any) {
    return this.settingsService.getCallingRules(user.companyId);
  }

  @Patch('calling-rules')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Update auto-dialler and retry rules' })
  updateCallingRules(@Body() data: UpdateCallingRulesDto, @CurrentUser() user: any) {
    return this.settingsService.updateCallingRules(user.companyId, data);
  }

  @Get('dispositions')
  @ApiOperation({ summary: 'Get disposition master list' })
  getDispositions(@CurrentUser() user: any) {
    return this.settingsService.getDispositions(user.companyId);
  }

  @Post('dispositions')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Create new disposition' })
  createDisposition(@Body() data: CreateDispositionDto, @CurrentUser() user: any) {
    return this.settingsService.createDisposition(data, user.companyId);
  }

  @Get('roles')
  @ApiOperation({ summary: 'Get system roles and permissions' })
  getRoles(@CurrentUser() user: any) {
    return this.settingsService.getRoles(user.companyId);
  }

  @Patch('roles/:id/permissions')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Update role permissions' })
  updatePermissions(
    @Param('id') id: string,
    @Body() body: UpdateRolePermissionsDto,
    @CurrentUser() user: any,
  ) {
    return this.settingsService.updateRolePermissions(id, body.permissions, user.companyId);
  }
}
