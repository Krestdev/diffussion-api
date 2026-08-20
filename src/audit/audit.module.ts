import { Module } from '@nestjs/common';
import { AuditLogService } from './audit.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
