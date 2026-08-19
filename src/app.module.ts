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
// import { DocumentModule } from './document/document.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { AuthMiddleware } from './common/middleware/auth.middleware';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ReferentielsModule } from './referentiels/referentiels.module';
import { DocumentModule } from './document/document.module';
import { InstructionsModule } from './instructions/instructions.module';
// import { LivrablesModule } from './livrables/livrables.module';

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
    ReferentielsModule,
    InstructionsModule,
    DocumentModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
    consumer
      .apply(AuthMiddleware)
      .exclude(
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'auth/register', method: RequestMethod.POST },
      )
      .forRoutes('*');
  }
}
