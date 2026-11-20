import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsObject,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AllocationMethodDto {
  EQUAL = 'EQUAL',
  ROUND_ROBIN = 'ROUND_ROBIN',
  CAPACITY_BASED = 'CAPACITY_BASED',
  MANUAL = 'MANUAL',
  PRIORITY_BASED = 'PRIORITY_BASED',
  PERFORMANCE = 'PERFORMANCE',
  AVAILABILITY = 'AVAILABILITY',
  WORKLOAD = 'WORKLOAD',
  TEAM = 'TEAM',
  HYBRID = 'HYBRID',
}

export class AllocateLeadsDto {
  @ApiProperty({ type: [String], description: 'Lead IDs to allocate (empty = unassigned in campaign)' })
  @IsArray()
  @IsOptional()
  leadIds?: string[];

  @ApiProperty({ type: [String], description: 'Telecaller user IDs' })
  @IsArray()
  @IsOptional()
  userIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiProperty({ enum: AllocationMethodDto, default: AllocationMethodDto.EQUAL })
  @IsEnum(AllocationMethodDto)
  method: AllocationMethodDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({ description: 'Max open leads per agent' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxPerUser?: number;

  @ApiPropertyOptional({ description: 'Percent weight per userId' })
  @IsOptional()
  @IsObject()
  percentages?: Record<string, number>;

  @ApiPropertyOptional({ description: 'Manual map leadId -> userId' })
  @IsOptional()
  @IsObject()
  manualMap?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Exact lead count per userId (overrides equal split)' })
  @IsOptional()
  @IsObject()
  targetCounts?: Record<string, number>;

  @ApiPropertyOptional({
    description:
      'When leadIds omitted, only take the first N unassigned leads (priority then oldest). Caps the pool before EQUAL/ROUND_ROBIN.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  excludeOnBreak?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  onlyUnassigned?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  hybridRules?: Record<string, unknown>;
}

export class TransferLeadsDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Lead IDs to move. Omit when using fromUserId + count.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  leadIds?: string[];

  @ApiPropertyOptional({ description: 'Only move leads currently assigned to this user' })
  @IsOptional()
  @IsString()
  fromUserId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  toUserId: string;

  @ApiPropertyOptional({
    description: 'When set, destination (and source) must be on this campaign; leads scoped to it',
  })
  @IsOptional()
  @IsString()
  campaignId?: string;

  @ApiPropertyOptional({
    description: 'Move N oldest eligible leads from fromUserId (used when leadIds empty)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  count?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiPropertyOptional({ description: 'Reason code for reassignment audit' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Allow moving INTERESTED/CONVERTED leads (default false)',
  })
  @IsOptional()
  @IsBoolean()
  allowProtectedOverride?: boolean;
}

export class UnworkedLeadsQueryDto {
  @ApiPropertyOptional({
    enum: [
      'NEVER_CALLED',
      'IDLE',
      'OVERDUE_FOLLOWUP',
      'INACTIVE_ASSIGNEE',
      'UNANSWERED_STREAK',
      'NEEDS_REVIEW',
      'ALL',
    ],
  })
  @IsOptional()
  @IsString()
  bucket?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedToId?: string;

  @ApiPropertyOptional({ description: 'Idle days threshold (default 2)' })
  @IsOptional()
  @IsNumber()
  idleDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  unansweredMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pageSize?: number;
}
