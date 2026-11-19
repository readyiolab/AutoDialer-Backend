import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import * as fs from 'fs';
import { Throttle } from '@nestjs/throttler';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { AllocateLeadsDto, TransferLeadsDto } from './dto/allocate-leads.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ADMIN_MUTATION_ROLES } from '../common/constants/roles';
import { PERMISSION } from '../common/constants/permissions';

const maxMb = Number(process.env.MAX_UPLOAD_MB || 25);

@ApiTags('Leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @RequirePermissions(PERMISSION.MANAGE_LEADS, PERMISSION.CALL_ASSIGNED_LEADS)
  create(@Body() createLeadDto: CreateLeadDto, @CurrentUser() user: any) {
    return this.leadsService.create(createLeadDto, user.companyId);
  }

  @Get()
  @RequirePermissions(PERMISSION.MANAGE_LEADS, PERMISSION.CALL_ASSIGNED_LEADS, PERMISSION.VIEW_MIS)
  findAll(@Query() query: any, @CurrentUser() user: any) {
    const filters = { ...query, companyId: user.companyId };
    if (user.roleName === 'TELECALLER') {
      filters.assignedToId = user.userId;
    }
    return this.leadsService.findAll(filters);
  }

  @Get('duplicates')
  @RequirePermissions(PERMISSION.MANAGE_LEADS)
  findDuplicates(@CurrentUser() user: any) {
    return this.leadsService.findDuplicates(user.companyId);
  }

  @Get('import-history')
  @RequirePermissions(PERMISSION.IMPORT_LEADS)
  getImportHistory(@CurrentUser() user: any) {
    return this.leadsService.getImportHistory(user.companyId);
  }

  @Get('import/:id/status')
  @RequirePermissions(PERMISSION.IMPORT_LEADS)
  importStatus(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leadsService.getImportStatus(id, user.companyId);
  }

  @Get('import/:id/rejected')
  @RequirePermissions(PERMISSION.IMPORT_LEADS)
  async downloadRejected(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const status = await this.leadsService.getImportStatus(id, user.companyId);
    if (!status.rejectedFileUrl || !fs.existsSync(status.rejectedFileUrl)) {
      throw new BadRequestException('Rejected file not available');
    }
    return res.download(status.rejectedFileUrl);
  }

  @Post('import/excel')
  @Roles(...ADMIN_MUTATION_ROLES)
  @RequirePermissions(PERMISSION.IMPORT_LEADS)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Upload Excel/CSV and preview with column mapping' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: maxMb * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
        cb(ok ? null : new BadRequestException('Only .xlsx, .xls, .csv allowed'), ok);
      },
    }),
  )
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('campaignId') campaignId: string,
    @Body('columnMapping') columnMappingRaw: string,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException('File is required');
    if (!campaignId?.trim()) {
      throw new BadRequestException('campaignId is required for Excel import');
    }
    let columnMapping: Record<string, string> | undefined;
    if (columnMappingRaw) {
      try {
        columnMapping = JSON.parse(columnMappingRaw);
      } catch {
        throw new BadRequestException('columnMapping must be JSON');
      }
    }
    return this.leadsService.parseExcelBuffer(
      file.buffer,
      file.originalname,
      user.companyId,
      user.userId,
      campaignId,
      columnMapping,
    );
  }

  @Post('import/confirm')
  @Roles(...ADMIN_MUTATION_ROLES)
  @RequirePermissions(PERMISSION.IMPORT_LEADS)
  confirmImport(
    @Body() body: { importHistoryId: string; columnMapping?: Record<string, string> },
    @CurrentUser() user: any,
  ) {
    return this.leadsService.confirmImport(
      body.importHistoryId,
      user.companyId,
      user.userId,
      body.columnMapping,
    );
  }

  @Post('import/:id/cancel')
  @Roles(...ADMIN_MUTATION_ROLES)
  @RequirePermissions(PERMISSION.IMPORT_LEADS)
  cancelImport(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leadsService.cancelImport(id, user.companyId, user.userId);
  }

  @Post('import/ocr')
  @Roles(...ADMIN_MUTATION_ROLES)
  @RequirePermissions(PERMISSION.IMPORT_LEADS)
  ocrExtract(@Body('text') text: string, @CurrentUser() user: any) {
    return this.leadsService.extractFromOcr(text, user.companyId);
  }

  @Post('allocate/preview')
  @Roles(...ADMIN_MUTATION_ROLES)
  @RequirePermissions(PERMISSION.ALLOCATE_LEADS)
  @ApiOperation({ summary: 'Preview lead distribution without committing' })
  previewAllocate(@Body() dto: AllocateLeadsDto, @CurrentUser() user: any) {
    return this.leadsService.previewAllocate(dto, user.companyId);
  }

  @Post('allocate')
  @Roles(...ADMIN_MUTATION_ROLES)
  @RequirePermissions(PERMISSION.ALLOCATE_LEADS)
  allocate(@Body() dto: AllocateLeadsDto, @CurrentUser() user: any) {
    return this.leadsService.allocate(dto, user.companyId, user.userId);
  }

  @Post('transfer')
  @Roles(...ADMIN_MUTATION_ROLES)
  @RequirePermissions(PERMISSION.ALLOCATE_LEADS)
  transfer(@Body() dto: TransferLeadsDto, @CurrentUser() user: any) {
    return this.leadsService.transfer(dto, user.companyId, user.userId);
  }

  @Get('unworked')
  @RequirePermissions(PERMISSION.ALLOCATE_LEADS, PERMISSION.MANAGE_LEADS, PERMISSION.VIEW_MIS)
  @ApiOperation({ summary: 'List unworked / aging leads for reassignment' })
  listUnworked(@Query() query: any, @CurrentUser() user: any) {
    return this.leadsService.listUnworked(user.companyId, query);
  }

  @Get(':id/assignments')
  @RequirePermissions(PERMISSION.MANAGE_LEADS, PERMISSION.ALLOCATE_LEADS, PERMISSION.VIEW_MIS)
  assignmentHistory(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leadsService.assignmentHistory(id, user.companyId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSION.MANAGE_LEADS, PERMISSION.CALL_ASSIGNED_LEADS)
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.leadsService.findOne(id, user.companyId, {
      requesterId: user.userId,
      roleName: user.roleName,
    });
  }

  @Patch(':id')
  @RequirePermissions(PERMISSION.MANAGE_LEADS, PERMISSION.CALL_ASSIGNED_LEADS)
  update(@Param('id') id: string, @Body() updateLeadDto: UpdateLeadDto, @CurrentUser() user: any) {
    return this.leadsService.update(id, updateLeadDto, user.companyId, user.userId, {
      roleName: user.roleName,
    });
  }

  @Patch(':id/blacklist')
  @Roles(...ADMIN_MUTATION_ROLES)
  @RequirePermissions(PERMISSION.MANAGE_LEADS)
  setBlacklist(
    @Param('id') id: string,
    @Body('isBlacklisted') isBlacklisted: boolean,
    @CurrentUser() user: any,
  ) {
    return this.leadsService.setBlacklist(id, isBlacklisted, user.companyId);
  }
}
