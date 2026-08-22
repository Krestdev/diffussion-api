import { Injectable, ConsoleLogger, LoggerService } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class DbLogger extends ConsoleLogger implements LoggerService {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  debug(message: any, context?: string) {
    // console.log('debug', message, context);

    super.debug(message, context); // keep console output
    this.persist('debug', message, context);
  }

  error(message: any, stack?: string, context?: string) {
    super.error(message, stack, context);
    this.persist('error', message, context, stack);
  }

  private persist(
    level: string,
    message: any,
    context?: string,
    stack?: string,
  ) {
    // fire-and-forget: never let logging break the request
    this.db.systemLog
      .create({ data: { level, message: String(message), context, stack } })
      .catch(() => void 0);
  }
}
