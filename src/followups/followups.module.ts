import { Module } from '@nestjs/common';
import { FollowUpsService } from './followups.service';
import { FollowUpsController } from './followups.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FollowUpsController],
  providers: [FollowUpsService],
  exports: [FollowUpsService],
})
export class FollowUpsModule {}

