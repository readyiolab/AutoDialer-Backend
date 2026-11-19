import { IsString, IsNotEmpty, IsOptional, IsEmail, IsNumber, IsEnum, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadPriority, LeadSource } from '@prisma/client';

export class CreateLeadDto {
  @ApiProperty({ example: 'Ramesh Kumar' })
  @IsString()
  @IsNotEmpty()
  customerName: string;

  @ApiProperty({ example: '9876543210' })
  @Matches(/^[6-9]\d{9}$/, { message: 'Must be a valid 10-digit Indian mobile number' })
  mobileNumber: string;

  @ApiPropertyOptional({ example: '9876543219' })
  @IsOptional()
  alternateMobile?: string;

  @ApiPropertyOptional({ example: 'ramesh@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F' })
  @IsOptional()
  @Transform(({ value }) =>
    value == null || String(value).trim() === ''
      ? undefined
      : String(value).trim().toUpperCase(),
  )
  @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, {
    message: 'PAN must be 10 characters like ABCDE1234F',
  })
  panNumber?: string;

  @ApiPropertyOptional({ example: '123456789012' })
  @IsOptional()
  @Transform(({ value }) =>
    value == null || String(value).trim() === ''
      ? undefined
      : String(value).replace(/\D/g, ''),
  )
  @Matches(/^\d{12}$/, { message: 'Aadhaar must be a 12-digit number' })
  aadhaarNumber?: string;

  @ApiPropertyOptional({ example: 'Delhi' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Delhi' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 'Sector 14' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 25000 })
  @IsOptional()
  @IsNumber()
  loanAmount?: number;

  @ApiPropertyOptional({ example: 'LN10023' })
  @IsOptional()
  @IsString()
  loanId?: string;

  @ApiPropertyOptional({ example: 25000 })
  @IsOptional()
  @IsNumber()
  outstandingAmount?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  dpd?: number;

  @ApiPropertyOptional({ example: 'TCS' })
  @IsOptional()
  @IsString()
  employer?: string;

  @ApiPropertyOptional({ example: 'Personal Loan' })
  @IsOptional()
  @IsString()
  product?: string;

  @ApiPropertyOptional({ example: 'Delhi Central' })
  @IsOptional()
  @IsString()
  leadBranch?: string;

  @ApiPropertyOptional({ enum: LeadSource })
  @IsOptional()
  @IsEnum(LeadSource)
  source?: LeadSource;

  @ApiPropertyOptional({ enum: LeadPriority })
  @IsOptional()
  @IsEnum(LeadPriority)
  priority?: LeadPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  customFields?: Record<string, any>;
}

