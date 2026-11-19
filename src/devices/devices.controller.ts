import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { USER_ADMIN_ROLES } from '../common/constants/roles';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Admin Devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @Roles(...USER_ADMIN_ROLES)
  @ApiOperation({ summary: 'List employee registered devices' })
  list(
    @CurrentUser() user: any,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.devices.listForCompany(user.companyId, userId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post('authorize-replacement')
  @Roles(...USER_ADMIN_ROLES)
  authorizeReplacement(
    @CurrentUser() user: any,
    @Body() body: { userId: string },
  ) {
    return this.devices.authorizeReplacement(body.userId, user.companyId, user.userId);
  }

  @Get(':id')
  @Roles(...USER_ADMIN_ROLES)
  get(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devices.getOne(id, user.companyId);
  }

  @Get(':id/history')
  @Roles(...USER_ADMIN_ROLES)
  history(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devices.history(id, user.companyId);
  }

  @Post(':id/block')
  @Roles(...USER_ADMIN_ROLES)
  block(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devices.block(id, user.companyId, user.userId);
  }

  @Post(':id/revoke')
  @Roles(...USER_ADMIN_ROLES)
  revoke(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devices.revoke(id, user.companyId, user.userId);
  }

  @Post(':id/reset')
  @Roles(...USER_ADMIN_ROLES)
  reset(@Param('id') id: string, @CurrentUser() user: any) {
    return this.devices.reset(id, user.companyId, user.userId);
  }
}
