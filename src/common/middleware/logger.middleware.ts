import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../cls.store';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly cls: ClsService<AppClsStore>) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = (req as any).__requestId;
    if (requestId) this.cls.set('requestId', requestId);

    const { ip, method, originalUrl } = req;
    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length') || 0;
      this.logger.log(`${method} ${originalUrl} ${statusCode} ${contentLength} - ${ip} [${requestId}]`);
    });

    next();
  }
}
