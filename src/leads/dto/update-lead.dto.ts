import { PartialType } from '@nestjs/swagger';
import { CreateLeadDto } from './create-lead.dto';
import { IsEnum, IsOptional, IsBoolean, IsDateString, IsNumber } from 'class-validator';
import { LeadStatus, LoanTrackingStatus } from '@prisma/client';

export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsBoolean()
  isBlacklisted?: boolean;

  @IsOptional()
  @IsBoolean()
  consentGiven?: boolean;

  @IsOptional()
  @IsDateString()
  consentDate?: string;

  @IsOptional()
  @IsEnum(LoanTrackingStatus)
  loanTrackingStatus?: LoanTrackingStatus;

  @IsOptional()
  @IsDateString()
  ptpDate?: string;

  @IsOptional()
  @IsNumber()
  ptpAmount?: number;
}

