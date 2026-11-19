import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AUDIT_READ_ROLES } from '../common/constants/roles';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles(...AUDIT_READ_ROLES)
  @ApiOperation({ summary: 'Get security audit logs' })
  getLogs(@Query() query: any, @CurrentUser() user: any) {
    return this.auditService.getLogs({ ...query, companyId: user.companyId });
  }
}
