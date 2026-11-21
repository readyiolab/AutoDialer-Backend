import { IsString, IsNotEmpty, IsEnum, IsOptional, IsArray, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageType } from '@prisma/client';

export class CreateTemplateDto {
  @ApiProperty({ example: 'LOAN_APPLICATION_01' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: MessageType })
  @IsEnum(MessageType)
  @IsNotEmpty()
  type: MessageType;

  @ApiPropertyOptional({ example: 'Loan Sourcing' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiProperty({
    example:
      'Hello! Welcome to Lmendigo.\n\nApply Now: {link}\n\nOur team will verify your application...',
    description:
      'Use {link} or {utm} for the telecaller UTM URL, and {customerName} for the lead name.',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiPropertyOptional({ type: [String], example: ['customerName', 'link'] })
  @IsOptional()
  @IsArray()
  variables?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isApproved?: boolean;
}

export class SendMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  leadId: string;

  @ApiProperty({ enum: MessageType })
  @IsEnum(MessageType)
  @IsNotEmpty()
  type: MessageType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  content: string;
}

