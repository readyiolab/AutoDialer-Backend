import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEmail,
  IsInt,
  Min,
  MinLength,
  IsUUID,
  Matches,
  IsBoolean,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'Rahul Sharma' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: '9876543210' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, { message: 'Phone must be a valid 10-digit Indian mobile number' })
  phone: string;

  @ApiPropertyOptional({ example: 'rahul@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Optional; invitation used when omitted' })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsUUID()
  roleId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reportingManagerId?: string;

  @ApiPropertyOptional({ example: 'EMP001', description: 'Auto-generated when omitted' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  dailyTarget?: number;

  @ApiPropertyOptional({
    example: 'https://example.com/apply?utm_source=tc106&utm_medium=whatsapp',
    description: 'Telecaller personal UTM / landing share link',
  })
  @IsOptional()
  @IsString()
  shareLink?: string;

  @ApiPropertyOptional({ example: 'ABCDE1234F', description: 'Required for TELECALLER' })
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

  @ApiPropertyOptional({ example: '123456789012', description: 'Required for TELECALLER' })
  @IsOptional()
  @Transform(({ value }) =>
    value == null || String(value).trim() === ''
      ? undefined
      : String(value).replace(/\D/g, ''),
  )
  @Matches(/^\d{12}$/, { message: 'Aadhaar must be a 12-digit number' })
  aadhaarNumber?: string;

  @ApiPropertyOptional({ description: 'Send invitation email instead of setting password' })
  @IsOptional()
  @IsBoolean()
  sendInvitation?: boolean;
}
