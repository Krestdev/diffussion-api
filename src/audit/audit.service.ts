import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { AuditLog } from 'generated/prisma/client';
import { DatabaseService } from 'src/database/database.service';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly database: DatabaseService) {}

  async record(entry: Partial<AuditLog>): Promise<void> {
    if (!entry.userId) {
      // this.logger.warn(`audit skipped — no userId: ${JSON.stringify(entry)}`);
      return;
    }

    // this.logger.debug(`audit record: ${JSON.stringify(entry)}`);
    try {
      await this.database.auditLog.create({
        data: {
          user: { connect: { id: entry.userId } },
          actions: entry.actions ?? 'unknown',
          entityId: entry.entityId,
          entityType: entry.entityType,
          metadata: entry.metadata ?? {},
        },
      });
    } catch (err) {
      this.logger.error('Failed to write audit log', err);
    }
  }
}
