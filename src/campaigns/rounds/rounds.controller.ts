import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ADMIN_MUTATION_ROLES } from '../../common/constants/roles';
import { RoundsService } from './rounds.service';
import { PreviewRoundDto } from './dto/preview-round.dto';
import { AllocateRoundDto, CreateRoundDto } from './dto/create-round.dto';

@ApiTags('Campaign Rounds')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('campaigns/:campaignId/rounds')
export class RoundsController {
  constructor(private readonly roundsService: RoundsService) {}

  @Get()
  @ApiOperation({ summary: 'List campaign rounds with progress counts' })
  list(@Param('campaignId') campaignId: string, @CurrentUser() user: any) {
    return this.roundsService.listRounds(campaignId, user.companyId);
  }

  @Post('preview')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Preview leads eligible for next round' })
  preview(
    @Param('campaignId') campaignId: string,
    @Body() dto: PreviewRoundDto,
    @CurrentUser() user: any,
  ) {
    return this.roundsService.preview(campaignId, user.companyId, dto);
  }

  @Post()
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Create next calling round from selected statuses/leads' })
  create(
    @Param('campaignId') campaignId: string,
    @Body() dto: CreateRoundDto,
    @CurrentUser() user: any,
  ) {
    return this.roundsService.createRound(
      campaignId,
      user.companyId,
      user.userId,
      dto,
    );
  }

  @Get(':roundId')
  @ApiOperation({ summary: 'Round detail + telecaller split' })
  getOne(
    @Param('campaignId') campaignId: string,
    @Param('roundId') roundId: string,
    @CurrentUser() user: any,
  ) {
    return this.roundsService.getRound(campaignId, roundId, user.companyId);
  }

  @Get(':roundId/analytics')
  @ApiOperation({ summary: 'Round-wise MIS (unique leads vs attempts)' })
  analytics(
    @Param('campaignId') campaignId: string,
    @Param('roundId') roundId: string,
    @CurrentUser() user: any,
  ) {
    return this.roundsService.getRoundAnalytics(campaignId, roundId, user.companyId);
  }

  @Post(':roundId/allocate')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Distribute round leads among telecallers' })
  allocate(
    @Param('campaignId') campaignId: string,
    @Param('roundId') roundId: string,
    @Body() dto: AllocateRoundDto,
    @CurrentUser() user: any,
  ) {
    return this.roundsService.allocateRound(
      campaignId,
      roundId,
      user.companyId,
      user.userId,
      dto,
    );
  }

  @Post(':roundId/complete')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Mark round completed' })
  complete(
    @Param('campaignId') campaignId: string,
    @Param('roundId') roundId: string,
    @CurrentUser() user: any,
  ) {
    return this.roundsService.completeRound(campaignId, roundId, user.companyId);
  }
}
