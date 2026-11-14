import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import {
  RedisSessionStore,
  SESSION_STORE,
  type SessionStore,
} from './session-store';

/**
 * The session store (Redis at REDIS_URL), for every module. The e2e tests replace it with a
 * MemorySessionStore (overrideProvider(SESSION_STORE)).
 *
 * KEEP THIS FILE IDENTICAL in creapp-core-api, creapp-api-v2 and creapp-ai-gateway.
 */
@Global()
@Module({
  providers: [
    {
      provide: SESSION_STORE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): SessionStore =>
        new RedisSessionStore(config.get('REDIS_URL')),
    },
  ],
  exports: [SESSION_STORE],
})
export class SessionStoreModule implements OnApplicationShutdown {
  constructor(@Inject(SESSION_STORE) private readonly store: SessionStore) {}

  async onApplicationShutdown(): Promise<void> {
    await this.store.close();
  }
}
