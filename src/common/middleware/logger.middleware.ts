import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../cls.store';

// Stamped by the request-id middleware registered ahead of this one in
// AppModule.configure().
type RequestWithId = Request & { __requestId?: string };

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly cls: ClsService<AppClsStore>) {}

  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const requestId = req.__requestId;
    if (requestId) this.cls.set('requestId', requestId);

    const { ip, method, originalUrl } = req;
    // IPv4 clients come in IPv6-mapped form (::ffff:192.168.1.78).
    if (ip) this.cls.set('ip', ip.replace(/^::ffff:/, ''));
    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length') || 0;
      this.logger.log(
        `${method} ${originalUrl} ${statusCode} ${contentLength} - ${ip} [${requestId}]`,
      );
    });

    next();
  }
}
