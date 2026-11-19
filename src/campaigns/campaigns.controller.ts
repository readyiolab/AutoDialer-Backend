import { Controller, Get, Post, Body, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { AssignUsersDto } from './dto/assign-users.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CampaignStatus } from '@prisma/client';
import { ADMIN_MUTATION_ROLES } from '../common/constants/roles';

@ApiTags('Campaigns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Create campaign' })
  create(@Body() createDto: CreateCampaignDto, @CurrentUser() user: any) {
    return this.campaignsService.create(createDto, user.companyId, user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'List all campaigns' })
  findAll(@CurrentUser() user: any) {
    return this.campaignsService.findAll(user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get campaign details' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.findOne(id, user.companyId);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get campaign metrics and conversion stats' })
  getStats(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.getStats(id, user.companyId);
  }

  @Patch(':id')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Update campaign' })
  update(@Param('id') id: string, @Body() updateDto: UpdateCampaignDto, @CurrentUser() user: any) {
    return this.campaignsService.update(id, updateDto, user.companyId);
  }

  @Patch(':id/pause')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Pause calling campaign' })
  pause(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.setStatus(id, CampaignStatus.PAUSED, user.companyId);
  }

  @Patch(':id/resume')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Resume calling campaign' })
  resume(@Param('id') id: string, @CurrentUser() user: any) {
    return this.campaignsService.setStatus(id, CampaignStatus.ACTIVE, user.companyId);
  }

  @Post(':id/assign-users')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Assign telecallers to campaign' })
  assignUsers(
    @Param('id') id: string,
    @Body() body: AssignUsersDto,
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.assignUsers(id, body.userIds, user.companyId);
  }

  @Post(':id/remove-users')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({
    summary: 'Remove telecallers from campaign (keeps call history)',
  })
  removeUsers(
    @Param('id') id: string,
    @Body() body: AssignUsersDto,
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.removeUsers(id, body.userIds, user.companyId);
  }

  @Post(':id/replace-users')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({
    summary: 'Replace campaign telecaller roster (remove all, then assign)',
  })
  replaceUsers(
    @Param('id') id: string,
    @Body() body: AssignUsersDto,
    @CurrentUser() user: any,
  ) {
    return this.campaignsService.replaceUsers(id, body.userIds, user.companyId);
  }
}
