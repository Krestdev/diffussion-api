import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new UnauthorizedException(
        'Authentication token is missing. Please provide a valid token.',
      );
    }

    // Check if the token has the Bearer prefix
    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Invalid authentication token format. Expected Bearer token.',
      );
    }

    next();
  }
}
