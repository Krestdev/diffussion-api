import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { accessToken } from '../auth/guards/core-auth.guard';
import { corsOrigins } from '../common/cors';
import { CoreAccessService } from '../core/core-access.service';
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

  constructor(private readonly access: CoreAccessService) {}

  /**
   * Same checks as CoreAuthGuard: the core's access cookie sent with the
   * handshake (withCredentials), a session the store confirms, a person with
   * a Diffusion role. Anything else is disconnected. An accepted socket joins
   * its user's room, which is what `emitToUsers` targets.
   */
  async handleConnection(client: Socket) {
    try {
      const token = accessToken({ headers: client.handshake.headers });
      if (!token) throw new Error('missing token');
      const result = await this.access.resolve(token);
      if (typeof result === 'string') throw new Error(result);
      await client.join(userRoom(result.account.id));
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
