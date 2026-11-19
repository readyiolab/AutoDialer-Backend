import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSION } from '../common/constants/permissions';

@ApiTags('Teams')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  @RequirePermissions(PERMISSION.MANAGE_TEAMS, PERMISSION.MANAGE_USERS)
  findAll(@CurrentUser() user: any) {
    return this.teamsService.findAll(user.companyId);
  }

  @Post()
  @RequirePermissions(PERMISSION.MANAGE_TEAMS)
  create(@Body() body: { name: string; managerId?: string }, @CurrentUser() user: any) {
    return this.teamsService.create(user.companyId, body, user.userId);
  }

  @Put(':id')
  @RequirePermissions(PERMISSION.MANAGE_TEAMS)
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; managerId?: string; isActive?: boolean },
    @CurrentUser() user: any,
  ) {
    return this.teamsService.update(id, user.companyId, body, user.userId);
  }
}
