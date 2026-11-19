import { Module } from '@nestjs/common';
import { DialerService } from './dialer.service';
import { DialerController } from './dialer.controller';
import { CallsModule } from '../calls/calls.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [CallsModule, AuditModule],
  controllers: [DialerController],
  providers: [DialerService],
  exports: [DialerService],
})
export class DialerModule {}
