import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../cls.store';

// Stamped by the request-id middleware registered ahead of this one in
// AppModule.configure().
type RequestWithId = Request & { __requestId?: string };

/** One header's value, trimmed and cut to `max` characters. */
function header(req: Request, name: string, max: number): string | null {
  const value = req.header(name)?.trim();
  return value ? value.slice(0, max) : null;
}

/**
 * The caller's browser and place (as EXPENZO's clientInfo). The place comes
 * from the proxy's geolocation headers (Cloudflare, Vercel, or X-Geo-* set by
 * the reverse proxy); without them it stays empty and the journal shows « — ».
 */
export function clientOf(req: Request): {
  userAgent: string | null;
  location: string | null;
} {
  const decode = (value: string | null) => {
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const city = decode(
    header(req, 'cf-ipcity', 80) ??
      header(req, 'x-vercel-ip-city', 80) ??
      header(req, 'x-geo-city', 80),
  );
  const country =
    header(req, 'cf-ipcountry', 8) ??
    header(req, 'x-vercel-ip-country', 8) ??
    header(req, 'x-geo-country', 8);
  const place = [city, country && country !== 'XX' ? country : null]
    .filter(Boolean)
    .join(', ');
  return {
    userAgent: header(req, 'user-agent', 500),
    location: place ? place.slice(0, 120) : null,
  };
}

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
    const client = clientOf(req);
    if (client.userAgent) this.cls.set('userAgent', client.userAgent);
    if (client.location) this.cls.set('location', client.location);
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
