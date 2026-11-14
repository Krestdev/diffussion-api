import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Reads and writes the session store (see contract.ts for the keys and records). Redis in
 * every environment; an in-memory copy in the e2e tests.
 *
 * KEEP THIS FILE IDENTICAL in creapp-core-api, creapp-api-v2 and creapp-ai-gateway.
 */
export interface SessionStore {
  /** Values in the order of the keys (null: absent). */
  read(keys: string[]): Promise<(string | null)[]>;
  /** Writes every entry at once, each with its lifetime in seconds. */
  write(
    entries: { key: string; value: string; ttlSeconds: number }[],
  ): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Sends a message to every subscriber of `channel`, in every process. */
  publish(channel: string, message: string): Promise<void>;
  /** Calls `handler` for each message on `channel`; returns the unsubscribe function. */
  subscribe(channel: string, handler: (message: string) => void): () => void;
  close(): Promise<void>;
}

/** Nest injection token of the store. */
export const SESSION_STORE = Symbol('SESSION_STORE');

/** The store could not be reached: callers refuse access rather than guess. */
export class SessionStoreUnavailableError extends Error {}

export class RedisSessionStore implements SessionStore {
  private readonly logger = new Logger('SessionStore');
  private readonly redis: Redis;
  /** A subscribed connection can't run other commands: its own, opened on first subscribe. */
  private subscriber: Redis | null = null;
  private readonly handlers = new Map<string, Set<(message: string) => void>>();

  constructor(private readonly url: string) {
    this.redis = new Redis(url, {
      // A request waits at most this long for the store, then fails (no endless queue).
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      enableOfflineQueue: true,
      lazyConnect: false,
    });
    this.redis.on('error', (error: Error) =>
      this.logger.warn(`session store: ${error.message}`),
    );
  }

  async read(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    try {
      return await this.redis.mget(...keys);
    } catch (error) {
      throw new SessionStoreUnavailableError(String(error));
    }
  }

  async write(
    entries: { key: string; value: string; ttlSeconds: number }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const pipeline = this.redis.multi();
    for (const entry of entries) {
      pipeline.set(
        entry.key,
        entry.value,
        'EX',
        Math.max(1, Math.ceil(entry.ttlSeconds)),
      );
    }
    try {
      const results = await pipeline.exec();
      const failed = results?.find(([error]) => error);
      if (failed?.[0]) throw failed[0];
    } catch (error) {
      throw new SessionStoreUnavailableError(String(error));
    }
  }

  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (error) {
      throw new SessionStoreUnavailableError(String(error));
    }
  }

  async publish(channel: string, message: string): Promise<void> {
    try {
      await this.redis.publish(channel, message);
    } catch (error) {
      throw new SessionStoreUnavailableError(String(error));
    }
  }

  subscribe(channel: string, handler: (message: string) => void): () => void {
    if (!this.subscriber) {
      this.subscriber = new Redis(this.url, {
        maxRetriesPerRequest: null,
        connectTimeout: 5000,
      });
      this.subscriber.on('error', (error: Error) =>
        this.logger.warn(`session store events: ${error.message}`),
      );
      this.subscriber.on('message', (from: string, message: string) => {
        for (const listener of this.handlers.get(from) ?? []) {
          try {
            listener(message);
          } catch (error) {
            this.logger.warn(`event handler failed: ${String(error)}`);
          }
        }
      });
    }
    let listeners = this.handlers.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.handlers.set(channel, listeners);
      void this.subscriber
        .subscribe(channel)
        .catch((error: unknown) =>
          this.logger.warn(
            `could not subscribe to ${channel}: ${String(error)}`,
          ),
        );
    }
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }

  async close(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
    await this.redis.quit().catch(() => undefined);
  }
}

/** The e2e tests' store: same behaviour, in memory. */
export class MemorySessionStore implements SessionStore {
  readonly entries = new Map<string, { value: string; expiresAt: number }>();

  read(keys: string[]): Promise<(string | null)[]> {
    const now = Date.now();
    return Promise.resolve(
      keys.map((key) => {
        const entry = this.entries.get(key);
        return entry && entry.expiresAt > now ? entry.value : null;
      }),
    );
  }

  write(
    entries: { key: string; value: string; ttlSeconds: number }[],
  ): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.key, {
        value: entry.value,
        expiresAt: Date.now() + entry.ttlSeconds * 1000,
      });
    }
    return Promise.resolve();
  }

  remove(keys: string[]): Promise<void> {
    for (const key of keys) this.entries.delete(key);
    return Promise.resolve();
  }

  private readonly handlers = new Map<string, Set<(message: string) => void>>();

  publish(channel: string, message: string): Promise<void> {
    // Delivered after the current task, as Redis would.
    for (const handler of [...(this.handlers.get(channel) ?? [])]) {
      setImmediate(() => handler(message));
    }
    return Promise.resolve();
  }

  subscribe(channel: string, handler: (message: string) => void): () => void {
    let listeners = this.handlers.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.handlers.set(channel, listeners);
    }
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
