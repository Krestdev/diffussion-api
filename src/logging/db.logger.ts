import { Injectable, ConsoleLogger, LoggerService } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../cls.store';

const FRAMEWORK_CONTEXTS = new Set([
  'InstanceLoader',
  'RouterExplorer',
  'RoutesResolver',
  'NestFactory',
  'NestApplication',
  'NestMicroservice',
]);

@Injectable()
export class DbLogger extends ConsoleLogger implements LoggerService {
  private persisting = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly cls: ClsService<AppClsStore>,
  ) {
    super();
  }

  warn(message: any, context?: any) {
    context ? super.warn(message, context) : super.warn(message);
    this.persist('warn', message, context);
  }

  error(message: any, stack?: string, context?: any) {
    context
      ? super.error(message, stack, context)
      : super.error(message, stack);
    this.persist('error', message, context, stack);
  }

  private persist(
    level: 'warn' | 'error',
    message: any,
    context?: string,
    stack?: string,
  ) {
    if (this.persisting || FRAMEWORK_CONTEXTS.has(context ?? '')) return;
    this.persisting = true;
    this.db.activityLog
      .create({
        data: {
          parentLogId: this.cls.get?.('parentLogId') ?? null,
          source: 'SYSTEM',
          level,
          action: `system.${level}`,
          message: String(message),
          stack,
        },
      })
      .catch(() => void 0)
      .finally(() => {
        this.persisting = false;
      });
  }
}
