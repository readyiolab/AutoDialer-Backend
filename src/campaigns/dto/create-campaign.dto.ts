import { IsString, IsNotEmpty, IsOptional, IsEnum, IsInt, IsDateString, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CampaignStatus, DialMode, AllocationMethod } from '@prisma/client';

export class CreateCampaignDto {
  @ApiProperty({ example: 'Personal Loan Sourcing Q1' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Calling prospective personal loan leads' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Personal Loan' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: CampaignStatus })
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @ApiPropertyOptional({ enum: DialMode })
  @IsOptional()
  @IsEnum(DialMode)
  dialMode?: DialMode;

  @ApiPropertyOptional({ enum: AllocationMethod })
  @IsOptional()
  @IsEnum(AllocationMethod)
  allocationMethod?: AllocationMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  allocationRules?: Record<string, unknown>;

  @ApiPropertyOptional({ default: 5 })
  @IsOptional()
  @IsInt()
  maxAttemptsPerLead?: number;

  @ApiPropertyOptional({ default: '09:00' })
  @IsOptional()
  @IsString()
  callingHoursStart?: string;

  @ApiPropertyOptional({ default: '18:00' })
  @IsOptional()
  @IsString()
  callingHoursEnd?: string;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @IsInt()
  retryInterval?: number;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional()
  @IsInt()
  dailyTarget?: number;
}
