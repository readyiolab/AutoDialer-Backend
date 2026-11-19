import { IsEmail, IsOptional, IsString, MinLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompanyDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountManagerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  subscription?: Record<string, unknown>;

  @ApiProperty({ description: 'Contact person who becomes company admin' })
  @IsString()
  @MinLength(2)
  adminName: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  adminPhone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  adminEmail?: string;
}

export class UpdateCompanyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountManagerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  subscription?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'INACTIVE'] })
  @IsOptional()
  @IsEnum(['ACTIVE', 'SUSPENDED', 'INACTIVE'])
  status?: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
}
