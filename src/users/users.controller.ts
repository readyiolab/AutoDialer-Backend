import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  ROLE,
  USER_ADMIN_ROLES,
  USER_DELETE_ROLES,
} from '../common/constants/roles';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users with pagination and filters' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'roleId', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiQuery({ name: 'search', required: false })
  async findAll(
    @CurrentUser() user: any,
    @Query() pagination: PaginationDto,
    @Query('status') status?: string,
    @Query('roleId') roleId?: string,
    @Query('branchId') branchId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('search') search?: string,
  ) {
    return this.usersService.findAll(user.companyId, pagination, {
      status,
      roleId,
      branchId,
      departmentId,
      search,
    });
  }

  @Get('online')
  @ApiOperation({ summary: 'Get currently online users' })
  async getOnlineUsers(@CurrentUser() user: any) {
    return this.usersService.getOnlineUsers(user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.usersService.findOne(id, user.companyId);
  }

  @Get(':id/performance')
  @ApiOperation({ summary: 'Get user performance stats' })
  async getPerformanceStats(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.usersService.getPerformanceStats(id, user.companyId, dateFrom, dateTo);
  }

  @Post()
  @Roles(...USER_ADMIN_ROLES)
  @ApiOperation({ summary: 'Create new user and send invitation' })
  async create(@Body() createUserDto: CreateUserDto, @CurrentUser() user: any) {
    return this.usersService.create(createUserDto, user.companyId, user.userId);
  }

  @Patch(':id')
  @Roles(...USER_ADMIN_ROLES)
  @ApiOperation({ summary: 'Update user' })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: any,
  ) {
    return this.usersService.update(id, updateUserDto, user.companyId);
  }

  @Post(':id/status')
  @Roles(...USER_ADMIN_ROLES)
  @HttpCode(HttpStatus.OK)
  async setStatus(
    @Param('id') id: string,
    @Body('status') status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED',
    @CurrentUser() user: any,
  ) {
    return this.usersService.setStatus(id, status, user.companyId, user.userId);
  }

  @Post(':id/resend-invitation')
  @Roles(...USER_ADMIN_ROLES)
  @HttpCode(HttpStatus.OK)
  async resendInvitation(@Param('id') id: string, @CurrentUser() user: any) {
    return this.usersService.resendInvitation(id, user.companyId, user.userId);
  }

  @Delete(':id')
  @Roles(...USER_DELETE_ROLES)
  @ApiOperation({ summary: 'Soft delete user (set inactive)' })
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.usersService.remove(id, user.companyId);
  }

  @Post(':id/reset-password')
  @Roles(ROLE.SUPER_ADMIN, ROLE.COMPANY_ADMIN, ROLE.OPS_HEAD)
  @ApiOperation({ summary: 'Reset user password' })
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Param('id') id: string,
    @Body() body: ResetPasswordDto,
    @CurrentUser() user: any,
  ) {
    return this.usersService.resetPassword(id, body.newPassword, user.companyId);
  }

  @Post(':id/register-device')
  @ApiOperation({ summary: 'Register device for user' })
  @HttpCode(HttpStatus.OK)
  async registerDevice(
    @Param('id') id: string,
    @Body() body: RegisterDeviceDto,
    @CurrentUser() user: any,
  ) {
    const isSelf = id === user.userId;
    const isAdmin = USER_ADMIN_ROLES.includes(user.roleName);
    if (!isSelf && !isAdmin) {
      throw new ForbiddenException('You can only register your own device');
    }
    return this.usersService.registerDevice(id, body.deviceId, user.companyId);
  }
}
