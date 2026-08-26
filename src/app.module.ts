import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ClsModule, ClsMiddleware } from 'nestjs-cls';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RbacModule } from './auth/rbac/rbac.module';
import { DatabaseModule } from './database/database.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ReferentialsModule } from './referentials/referentials.module';
import { DocumentModule } from './document/document.module';
import { InstructionsModule } from './instructions/instructions.module';
import { DbLogger } from './logging/db.logger';
import { ActivityModule } from './activity/activity.module';
import { AdministrationModule } from './administration/administration.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DocumentsModule } from './documents/documents.module';
import { CircuitsModule } from './circuits/circuits.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ClsModule.forRoot({
      middleware: { mount: false },
      global: true,
    }),
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL'),
        },
      }),
    }),
    DatabaseModule,
    // Global: every domain module can inject ActivityService directly to
    // record its own events; the module also registers the APP_INTERCEPTOR
    // that logs one root entry per authenticated, non-GET request.
    ActivityModule,
    AuthModule,
    RbacModule,
    ReferentialsModule,
    InstructionsModule,
    DocumentModule,
    AdministrationModule,
    NotificationsModule,
    DocumentsModule,
    CircuitsModule,
    StorageModule,
  ],
  controllers: [AppController],
  providers: [AppService, DbLogger],
})
export class AppModule implements NestModule {
  // Authentication/authorization is enforced per-controller via
  // @UseGuards(JwtAuthGuard, PermissionGuard) + @RequirePermission(...)
  // rather than a global middleware, so each route can declare its own
  // permission requirement.
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        (req: RequestWithId, res: ResponseLike, next: NextFn) => {
          const id = (req.headers['x-request-id'] as string) ?? randomUUID();
          res.setHeader('x-request-id', id);
          req.__requestId = id;
          next();
        },
        ClsMiddleware,
        LoggerMiddleware,
      )
      .forRoutes('*');
  }
}

// Minimal structural types for the inline request-id middleware above —
// avoids pulling in `any` just to stamp a correlation id on the request.
type RequestWithId = {
  headers: Record<string, string | string[] | undefined>;
  __requestId?: string;
};
type ResponseLike = { setHeader: (name: string, value: string) => void };
type NextFn = () => void;
