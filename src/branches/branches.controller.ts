import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ADMIN_MUTATION_ROLES } from '../common/constants/roles';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@ApiTags('Branches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @ApiOperation({ summary: 'List all company branches' })
  findAll(@CurrentUser() user: any) {
    return this.branchesService.findAll(user.companyId);
  }

  @Post()
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Create new branch' })
  create(@Body() data: CreateBranchDto, @CurrentUser() user: any) {
    return this.branchesService.create(data, user.companyId);
  }

  @Patch(':id')
  @Roles(...ADMIN_MUTATION_ROLES)
  @ApiOperation({ summary: 'Update branch' })
  update(@Param('id') id: string, @Body() data: UpdateBranchDto, @CurrentUser() user: any) {
    return this.branchesService.update(id, data, user.companyId);
  }
}
