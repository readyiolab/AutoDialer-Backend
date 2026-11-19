import { IsString, IsNotEmpty, IsOptional, IsInt, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCallDto {
  @ApiProperty({ description: 'Lead ID to call' })
  @IsString()
  @IsNotEmpty()
  leadId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiProperty()
  @IsDateString()
  startTime: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endTime?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  duration?: number;

  @ApiPropertyOptional({ example: 'OFF_HOOK / CALL_ENDED' })
  @IsOptional()
  @IsString()
  rawCallState?: string;
}

