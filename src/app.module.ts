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
import { DomainModule } from './domain/domain.module';
import { InstructionsModule } from './instructions/instructions.module';
import { DbLogger } from './logging/db.logger';
import { ActivityModule } from './activity/activity.module';
import { AdministrationModule } from './administration/administration.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DocumentsModule } from './documents/documents.module';
import { CircuitsModule } from './circuits/circuits.module';
import { StorageModule } from './storage/storage.module';
import { MailModule } from './mail/mail.module';
import { AnalysisModule } from './analysis/analysis.module';

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
    CircuitsModule,
    StorageModule,
    AnalysisModule,
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
