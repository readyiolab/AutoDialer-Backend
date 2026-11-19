import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeadStatus, AllocationMethod } from '@prisma/client';

export class CreateRoundAllocateDto {
  @ApiPropertyOptional({ enum: AllocationMethod })
  @IsOptional()
  @IsEnum(AllocationMethod)
  method?: AllocationMethod;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  targetCounts?: Record<string, number>;
}

export class CreateRoundDto {
  @ApiPropertyOptional({ enum: LeadStatus, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(LeadStatus, { each: true })
  statuses?: LeadStatus[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  leadIds?: string[];

  @ApiPropertyOptional({ description: 'Clear assignee until redistribute' })
  @IsOptional()
  @IsBoolean()
  clearAssignees?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateRoundAllocateDto)
  allocate?: CreateRoundAllocateDto;
}

export class AllocateRoundDto {
  @ApiProperty({ enum: AllocationMethod })
  @IsEnum(AllocationMethod)
  method: AllocationMethod;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  targetCounts?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  maxPerUser?: number;
}
