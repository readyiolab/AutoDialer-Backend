import { IsNotEmpty, IsString, IsOptional, IsIn, IsArray, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: '9999999999' })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty({ example: 'admin123' })
  @IsNotEmpty()
  @IsString()
  password: string;

  @ApiPropertyOptional({ description: 'Required when the phone exists in multiple companies' })
  @IsOptional()
  @IsString()
  companyCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deviceId?: string;

  @ApiPropertyOptional({
    description:
      'Android only: after valid password, revoke previous ACTIVE device and bind this deviceId',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1')
  @IsBoolean()
  forceReplaceDevice?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  publicKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  model?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  androidVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  riskFlags?: string[];

  @ApiPropertyOptional({ enum: ['web', 'android'], default: 'web' })
  @IsOptional()
  @IsIn(['web', 'android'])
  clientType?: 'web' | 'android';
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  refreshToken: string;
}
