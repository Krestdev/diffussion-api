import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
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
import { ClsModule, ClsMiddleware } from 'nestjs-cls';
import { randomUUID } from 'crypto';
import { AppClsStore } from './cls.store';

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
        connection: { url: config.get('REDIS_URL') },
      }),
    }),
    DatabaseModule,
    ActivityModule,
    AuthModule,
    RbacModule,
    ReferentialsModule,
    InstructionsModule,
    DocumentModule,
  ],
  controllers: [AppController],
  providers: [AppService, DbLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(
        (req: any, res: any, next: any) => {
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
