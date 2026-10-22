import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UserStatus } from '../../generated/prisma/client';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { corsOrigins } from '../common/cors';
import { DatabaseService } from '../database/database.service';

/** Events the frontend's SocketProvider listens for. */
export type RealtimeEvent =
  'notification:new' | 'user:new' | 'user:update' | 'user:delete';

const userRoom = (userId: string) => `user:${userId}`;

/**
 * socket.io endpoint on the API's own port (`/socket.io/`). Push-only: it
 * tells connected browsers *that* something changed, and they refetch
 * through the regular (permission-checked) REST endpoints — so payloads
 * carry ids only, never data the recipient couldn't otherwise read.
 */
@WebSocketGateway({ cors: { origin: corsOrigins(), credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private readonly server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly database: DatabaseService,
  ) {}

  /**
   * Same checks as JwtStrategy: a valid access token from
   * `handshake.auth.token`, for an account that is still ACTIVE. Anything
   * else is disconnected. An accepted socket joins its user's room, which
   * is what `emitToUsers` targets.
   */
  async handleConnection(client: Socket) {
    const token: unknown = client.handshake.auth?.token;
    try {
      if (typeof token !== 'string' || !token) {
        throw new Error('missing token');
      }
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: process.env.JWT_SECRET,
      });
      const user = await this.database.user.findUnique({
        where: { id: payload.sub },
        select: { status: true },
      });
      if (user?.status !== UserStatus.ACTIVE) {
        throw new Error('account is not active');
      }
      await client.join(userRoom(payload.sub));
    } catch (error) {
      this.logger.debug(
        `Rejected socket ${client.id}: ${(error as Error).message}`,
      );
      client.disconnect(true);
    }
  }

  emitToUsers(userIds: string[], event: RealtimeEvent, payload?: unknown) {
    if (userIds.length === 0) return;
    this.server.to(userIds.map(userRoom)).emit(event, payload);
  }

  /** To every authenticated socket. */
  broadcast(event: RealtimeEvent, payload?: unknown) {
    this.server.emit(event, payload);
  }
}
