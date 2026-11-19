import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { CallsModule } from './calls/calls.module';
import { FollowUpsModule } from './followups/followups.module';
import { CommunicationModule } from './communication/communication.module';
import { ReportsModule } from './reports/reports.module';
import { AutomationModule } from './automation/automation.module';
import { BranchesModule } from './branches/branches.module';
import { AttendanceModule } from './attendance/attendance.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { HealthModule } from './health/health.module';
import { MailModule } from './mail/mail.module';
import { CompaniesModule } from './companies/companies.module';
import { QueueModule } from './queue/queue.module';
import { DialerModule } from './dialer/dialer.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TeamsModule } from './teams/teams.module';
import { RealtimeModule } from './realtime/realtime.module';
import { MobileModule } from './mobile/mobile.module';
import { DevicesModule } from './devices/devices.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    MailModule,
    QueueModule,
    RealtimeModule,
    HealthModule,
    AuthModule,
    CompaniesModule,
    UsersModule,
    TeamsModule,
    LeadsModule,
    CampaignsModule,
    CallsModule,
    DialerModule,
    FollowUpsModule,
    CommunicationModule,
    ReportsModule,
    AutomationModule,
    BranchesModule,
    AttendanceModule,
    AuditModule,
    SettingsModule,
    NotificationsModule,
    MobileModule,
    DevicesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
