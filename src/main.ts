import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { DatabaseService } from './database/database.service';
import { DbLogger } from './logging/db.logger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ClsService } from 'nestjs-cls';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(DbLogger));

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
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 8000);
}
void bootstrap();
