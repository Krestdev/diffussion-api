import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { accessToken } from '../auth/guards/core-auth.guard';
import { CoreAccessService } from '../core/core-access.service';
import type { DataChange } from './changes';

/**
 * Events the UI's SocketIOProvider listens for (as EXPENZO's):
 * - `notification`: a new notification of the user (the inbox entry, translated by the UI);
 * - `change`: data changed in the company (what, never the data);
 * - `access`: the user's roles or delegations changed (reload their rights);
 * - `user:new` / `user:update` / `user:delete`: the directory changed.
 */
export type RealtimeEvent =
  | 'notification'
  | 'change'
  | 'access'
  | 'user:new'
  | 'user:update'
  | 'user:delete';

/** Path of the socket.io endpoint, under /api/v1 so the UI's Next rewrite forwards it. */
export const REALTIME_PATH = '/api/v1/realtime';

const userRoom = (userId: string) => `user:${userId}`;
const companyRoom = (companyId: string) => `company:${companyId}`;

/**
 * Live updates to the browser, as EXPENZO's RealtimeGateway. The API has no public address: the
 * UI reaches it through its own origin's /api/v1 rewrite (next.config.ts), which forwards the
 * WebSocket upgrade (HTTP long-polling is the fallback) with the core's access cookie. A socket is
 * accepted only with the same checks as CoreAuthGuard (a session the store confirms, a person
 * with a Diffusion role), and joins its user's room (their notifications) and its company's room
 * (data changes). Push-only: payloads say *that* something changed, and each tab reloads it
 * through the regular, permission-checked REST endpoints.
 */
// No trailing slash: the UI's proxy (Next) would redirect it away. Same origin only: no CORS.
@WebSocketGateway({
  path: REALTIME_PATH,
  addTrailingSlash: false,
  cors: false,
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private readonly server?: Server;

  constructor(private readonly access: CoreAccessService) {}

  async handleConnection(client: Socket) {
    try {
      const token = accessToken({ headers: client.handshake.headers });
      if (!token) throw new Error('missing token');
      const result = await this.access.resolve(token);
      if (typeof result === 'string') throw new Error(result);
      await client.join([
        userRoom(result.account.id),
        companyRoom(result.account.tenant.id),
      ]);
    } catch (error) {
      this.logger.debug(
        `Rejected socket ${client.id}: ${(error as Error).message}`,
      );
      client.disconnect(true);
    }
  }

  /** Sends an event to every open tab of a user. */
  toUser(userId: string, event: RealtimeEvent, payload?: unknown) {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  emitToUsers(userIds: string[], event: RealtimeEvent, payload?: unknown) {
    if (userIds.length === 0) return;
    this.server?.to(userIds.map(userRoom)).emit(event, payload);
  }

  /** People's roles or delegations changed: their tabs reload their rights and lists. */
  accessChanged(userIds: string[]) {
    this.emitToUsers([...new Set(userIds)], 'access', {});
  }

  /**
   * Tells the browsers that data changed: every tab of the company, or only the author's own
   * tabs for a personal change (their notifications).
   */
  publish(
    companyId: string | null | undefined,
    change: DataChange,
    personal = false,
  ) {
    if (personal || !companyId) {
      this.toUser(change.by, 'change', change);
      return;
    }
    this.server?.to(companyRoom(companyId)).emit('change', change);
  }

  /** To every authenticated socket. */
  broadcast(event: RealtimeEvent, payload?: unknown) {
    this.server?.emit(event, payload);
  }
}
