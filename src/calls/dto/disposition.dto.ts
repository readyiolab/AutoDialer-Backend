import { IsEnum, IsNotEmpty, IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CallDisposition, CallCategory, LeadPriority } from '@prisma/client';

export class SubmitDispositionDto {
  @ApiProperty({ enum: CallDisposition })
  @IsEnum(CallDisposition)
  @IsNotEmpty()
  disposition: CallDisposition;

  @ApiProperty({ enum: CallCategory })
  @IsEnum(CallCategory)
  @IsNotEmpty()
  category: CallCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional({ example: '2026-11-13' })
  @IsOptional()
  @IsDateString()
  followUpDate?: string;

  @ApiPropertyOptional({ example: '11:00 AM' })
  @IsOptional()
  @IsString()
  followUpTime?: string;

  @ApiPropertyOptional({ enum: LeadPriority })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  voiceNoteUrl?: string;
}

