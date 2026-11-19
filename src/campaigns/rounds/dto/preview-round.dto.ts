import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { LeadStatus } from '@prisma/client';

export class PreviewRoundDto {
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

  @ApiPropertyOptional({ description: 'Limit sample rows in preview' })
  @IsOptional()
  sampleSize?: number;
}
