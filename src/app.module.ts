import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RbacModule } from './auth/rbac/rbac.module';
import { DatabaseModule } from './database/database.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { AuthMiddleware } from './common/middleware/auth.middleware';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ReferentialsModule } from './referentials/referentials.module';
import { DocumentModule } from './document/document.module';
import { InstructionsModule } from './instructions/instructions.module';
import { AuditModule } from './audit/audit.module';
import { AuditLogMiddleware } from './common/middleware/audit-log.middleware';
import { DbLogger } from './logging/db.logger';
import { AdministrationModule } from './administration/administration.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DocumentsModule } from './documents/documents.module';
import { CircuitsModule } from './circuits/circuits.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get('REDIS_URL'),
        },
      }),
    }),
    DatabaseModule,
    AuthModule,
    RbacModule,
    ReferentialsModule,
    InstructionsModule,
    DocumentModule,
    AuditModule,
    AdministrationModule,
    NotificationsModule,
    DocumentsModule,
    CircuitsModule,
  ],
  controllers: [AppController],
  providers: [AppService, DbLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware, AuditLogMiddleware).forRoutes('*');
    // consumer
    //   .apply(AuthMiddleware)
    //   .exclude(
    //     { path: 'auth/login', method: RequestMethod.POST },
    //     { path: 'auth/register', method: RequestMethod.POST },
    //   )
    //   .forRoutes('*');
  }
}
