import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/types/jwt-payload.type';

/**
 * Push-only invalidation channel (see the frontend's rest-query-socket-layer
 * pattern): every event here just says "something about resource X
 * changed" — clients always refetch the real data over REST, never trust a
 * socket payload as the source of truth. Never push resource data itself.
 *
 * Auth mirrors the REST API's own JWT (same secret, same payload shape),
 * sent as `socket.handshake.auth.token` — see lib/sockets.ts on the
 * frontend. A connection that doesn't carry a valid token is dropped
 * immediately rather than left anonymous, and a valid one joins a room
 * named after its own userId so per-user events can be targeted without
 * broadcasting to every connected client.
 */
@Injectable()
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly jwtService: JwtService) {}

  handleConnection(client: Socket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ||
      client.handshake.headers.authorization?.toString().replace(/^Bearer /, '');
    if (!token) {
      this.logger.warn(`Socket ${client.id} connected without a token — disconnecting`);
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: process.env.JWT_SECRET,
      });
      void client.join(`user:${payload.sub}`);
    } catch {
      this.logger.warn(`Socket ${client.id} sent an invalid/expired token — disconnecting`);
      client.disconnect(true);
    }
  }

  handleDisconnect() {
    // Nothing to clean up manually — socket.io drops room membership on
    // disconnect on its own.
  }

  /** Fan-out to one user's own connections (they may have several tabs open). */
  emitToUser(userId: string, event: string, payload?: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  /** Broadcast to every connected client — for resources with no per-user scope. */
  broadcast(event: string, payload?: unknown) {
    this.server.emit(event, payload);
  }
}
