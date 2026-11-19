import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { RoundsController } from './rounds/rounds.controller';
import { RoundsService } from './rounds/rounds.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CampaignsController, RoundsController],
  providers: [CampaignsService, RoundsService],
  exports: [CampaignsService, RoundsService],
})
export class CampaignsModule {}

