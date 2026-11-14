import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './AppModule';
import { DatabaseService } from './database/database.service';
import { DbLogger } from './logging/db.logger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ClsService } from 'nestjs-cls';
import { corsOrigins } from './common/cors';
import { API_PREFIX, API_PREFIX_OPTIONS } from './common/api-prefix';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(DbLogger));
  // Every route under /api/v1, as EXPENZO and the core (the core's console calls
  // /api/v1/app-admin/...). The root stays where the health check reads it.
  app.setGlobalPrefix(API_PREFIX, API_PREFIX_OPTIONS);

  // The Next.js frontend runs on a different origin (localhost:4000) and
  // sends the CREAPP core's access cookie (creapp_access) with each call:
  // credentials are allowed, for the listed origins only.
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });

  app.useGlobalFilters(
    new AllExceptionsFilter(app.get(ClsService), app.get(DbLogger)),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const databaseService = app.get(DatabaseService);
  databaseService.enableShutdownHooks(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Diffusion API')
    .setDescription('API documentation for the Diffusion service')
    .setVersion('1.0')
    .addCookieAuth('creapp_access')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 8000);
}
void bootstrap();
