import { Controller, Get, Query, UseGuards, Res, Param, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PERMISSION } from '../common/constants/permissions';
import { ADMIN_MUTATION_ROLES, ROLE } from '../common/constants/roles';

@ApiTags('Reports & MIS')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS, PERMISSION.MONITOR_LIVE)
  @ApiOperation({ summary: 'Executive admin dashboard key performance metrics' })
  getDashboardSummary(@CurrentUser() user: any) {
    return this.reportsService.getDashboardSummary(user.companyId);
  }

  @Get('daily-calling')
  @RequirePermissions(PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS)
  @ApiOperation({ summary: 'Daily Calling MIS Report with detailed dial breakdowns' })
  getDailyCallingMIS(@Query() query: any, @CurrentUser() user: any) {
    return this.reportsService.getDailyCallingMIS({ ...query, companyId: user.companyId });
  }

  @Get('telecaller-lead-overview')
  @RequirePermissions(PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS)
  @ApiOperation({ summary: 'Telecaller-wise lead counts by status bucket' })
  getTelecallerLeadOverview(@Query() query: any, @CurrentUser() user: any) {
    return this.reportsService.getTelecallerLeadOverview(user.companyId, {
      campaignId: query.campaignId,
      teamId: query.teamId,
    });
  }

  @Get('employee-productivity')
  @RequirePermissions(PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS)
  @ApiOperation({ summary: 'Employee-wise productivity, lead status and ranking' })
  getEmployeeProductivityMIS(@Query() query: any, @CurrentUser() user: any) {
    return this.reportsService.getEmployeeProductivityMIS(user.companyId, {
      campaignId: query.campaignId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }

  @Get('employee')
  @RequirePermissions(PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS)
  getEmployeeAlias(@Query() query: any, @CurrentUser() user: any) {
    return this.reportsService.getEmployeeProductivityMIS(user.companyId, {
      campaignId: query.campaignId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });
  }

  @Get('employees/:userId/leads')
  @RequirePermissions(PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS)
  @ApiOperation({ summary: 'Drill-down leads assigned to one telecaller' })
  getEmployeeLeads(
    @Param('userId') userId: string,
    @Query() query: any,
    @CurrentUser() user: any,
  ) {
    return this.reportsService.getEmployeeLeads(user.companyId, userId, query);
  }

  @Get('campaign')
  @RequirePermissions(PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS)
  @ApiOperation({ summary: 'Campaign-wise reach, connection and conversion MIS' })
  getCampaignMIS(@CurrentUser() user: any) {
    return this.reportsService.getCampaignMIS(user.companyId);
  }

  @Get('branch')
  @RequirePermissions(PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS)
  @ApiOperation({ summary: 'Branch & territory comparison performance report' })
  getBranchMIS(@CurrentUser() user: any) {
    return this.reportsService.getBranchMIS(user.companyId);
  }

  @Get('communication')
  @RequirePermissions(PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS)
  @ApiOperation({ summary: 'WhatsApp and SMS dispatch & delivery MIS' })
  getCommunicationMIS(@CurrentUser() user: any) {
    return this.reportsService.getCommunicationMIS(user.companyId);
  }

  @Get('export/:type')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_MUTATION_ROLES, ROLE.CEO, ROLE.MIS_EXECUTIVE)
  @RequirePermissions(PERMISSION.EXPORT_DATA)
  @ApiOperation({ summary: 'Export MIS report as CSV (admin roles only)' })
  async export(
    @Param('type') type: string,
    @Query() query: any,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    let data: any;
    switch (type) {
      case 'daily-calling':
      case 'daily':
        data = await this.reportsService.getDailyCallingMIS({
          ...query,
          companyId: user.companyId,
        });
        break;
      case 'employee':
        data = await this.reportsService.getEmployeeProductivityMIS(user.companyId);
        break;
      case 'telecaller-overview':
        data = await this.reportsService.getTelecallerLeadOverview(user.companyId, query);
        break;
      case 'campaign':
        data = await this.reportsService.getCampaignMIS(user.companyId);
        break;
      case 'branch':
        data = await this.reportsService.getBranchMIS(user.companyId);
        break;
      default:
        throw new BadRequestException('Unknown export type');
    }

    const rows = Array.isArray(data)
      ? data
      : data?.employees || data?.campaigns || data?.branches || [data];
    if (!rows.length) {
      res.setHeader('Content-Type', 'text/csv');
      return res.send('No data\n');
    }
    const keys = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object');
    const csv = [
      keys.join(','),
      ...rows.map((r: any) =>
        keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
    return res.send(csv);
  }
}
