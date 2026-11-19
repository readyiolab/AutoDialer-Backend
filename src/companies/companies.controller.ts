import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ROLE } from '../common/constants/roles';
import { PERMISSION } from '../common/constants/permissions';

@ApiTags('Companies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  @Roles(ROLE.SUPER_ADMIN)
  @RequirePermissions(PERMISSION.MANAGE_COMPANIES)
  @ApiOperation({ summary: 'List all customer companies (platform admin)' })
  findAll(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.companiesService.findAll(
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
      search,
    );
  }

  @Get(':id')
  @Roles(ROLE.SUPER_ADMIN)
  @RequirePermissions(PERMISSION.MANAGE_COMPANIES)
  findOne(@Param('id') id: string) {
    return this.companiesService.findOne(id);
  }

  @Post()
  @Roles(ROLE.SUPER_ADMIN)
  @RequirePermissions(PERMISSION.MANAGE_COMPANIES)
  @ApiOperation({ summary: 'Create customer company and invite admin' })
  create(@Body() dto: CreateCompanyDto, @CurrentUser() user: any) {
    return this.companiesService.create(dto, user.userId);
  }

  @Put(':id')
  @Roles(ROLE.SUPER_ADMIN)
  @RequirePermissions(PERMISSION.MANAGE_COMPANIES)
  update(@Param('id') id: string, @Body() dto: UpdateCompanyDto, @CurrentUser() user: any) {
    return this.companiesService.update(id, dto, user.userId);
  }

  @Patch(':id/status')
  @Roles(ROLE.SUPER_ADMIN)
  @RequirePermissions(PERMISSION.MANAGE_COMPANIES)
  setStatus(
    @Param('id') id: string,
    @Body('status') status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE',
    @CurrentUser() user: any,
  ) {
    return this.companiesService.setStatus(id, status, user.userId);
  }
}
