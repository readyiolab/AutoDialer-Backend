import { Module } from '@nestjs/common';
import { MobileController } from './mobile.controller';
import { MobileService } from './mobile.service';
import { AuthModule } from '../auth/auth.module';
import { DialerModule } from '../dialer/dialer.module';
import { CallsModule } from '../calls/calls.module';
import { LeadsModule } from '../leads/leads.module';
import { FollowUpsModule } from '../followups/followups.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { DevicesModule } from '../devices/devices.module';
import { CommunicationModule } from '../communication/communication.module';

@Module({
  imports: [
    AuthModule,
    DialerModule,
    CallsModule,
    LeadsModule,
    FollowUpsModule,
    NotificationsModule,
    UsersModule,
    DevicesModule,
    CommunicationModule,
  ],
  controllers: [MobileController],
  providers: [MobileService],
})
export class MobileModule {}
