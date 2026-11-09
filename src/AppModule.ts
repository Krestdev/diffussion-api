import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { ClsModule, ClsMiddleware } from 'nestjs-cls';
import { ActivityModule } from './activity/activity.module';
import { AdministrationModule } from './administration/administration.module';
import { AnalysisModule } from './analysis/analysis.module';
import { AppController } from './app.controller';
import { RequestWithId, ResponseLike, NextFn } from './app.module';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RbacModule } from './auth/rbac/rbac.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { DocumentsModule } from './documents/documents.module';
import { DomainModule } from './domain/domain.module';
import { InstructionsModule } from './instructions/instructions.module';
import { DbLogger } from './logging/db.logger';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReferentialsModule } from './referentials/referentials.module';
import { StorageModule } from './storage/storage.module';
import { SupportModule } from './support/support.module';

@Module({
  imports: [
    ClsModule.forRoot({
      middleware: { mount: false },
      global: true,
    }),
    ConfigModule.forRoot({ isGlobal: true }),
    // Global rate limiting: 100 requests per minute per IP by default.
    // Sensitive routes (auth) override this with a tighter @Throttle({...}).
    ThrottlerModule.forRoot([
      {
        ttl: 60_000, // 1-minute window (ms)
        limit: 100, // max requests per window per client IP
      },
    ]),
    DatabaseModule,
    MailModule,
    // Global: every domain module can inject ActivityService directly to
    // record its own business events. The first record() call in a request
    // is automatically promoted to root in the audit-log view.
    ActivityModule,
    AuthModule,
    RbacModule,
    ReferentialsModule,
    InstructionsModule,
    DomainModule,
    AdministrationModule,
    NotificationsModule,
    DocumentsModule,
    StorageModule,
    AnalysisModule,
    DashboardModule,
    SupportModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    DbLogger,
    // Register ThrottlerGuard globally so every route is rate-limited without
    // needing @UseGuards(ThrottlerGuard) on each controller.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
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
