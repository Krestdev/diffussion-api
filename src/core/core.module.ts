import { Global, Module } from '@nestjs/common';
import { AppAccessService } from './app-access.service';
import { CoreAccessService } from './core-access.service';
import { CoreClient } from './core-client';
import { CoreJwks, CoreTokensService } from './core-tokens.service';
import { DirectorySyncService } from './directory-sync.service';

/**
 * Diffusion on the CREAPP core: core tokens checked with its public keys, sessions read from the
 * session store, the directory (companies, people) kept in sync, and people's access to
 * Diffusion (its own roles) published back to the store.
 */
@Global()
@Module({
  providers: [
    CoreJwks,
    CoreTokensService,
    CoreClient,
    DirectorySyncService,
    AppAccessService,
    CoreAccessService,
  ],
  exports: [
    AppAccessService,
    CoreTokensService,
    CoreClient,
    DirectorySyncService,
    CoreAccessService,
  ],
})
export class CoreModule {}
