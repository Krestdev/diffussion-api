import {
  INestApplication,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  constructor() {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    const adapter = new PrismaPg(pool);
    super({
      adapter,
      log: ['error', 'warn'],
    });
  }

  enableShutdownHooks(app: INestApplication): void {
    process.on('SIGTERM', () => {
      void app.close();
    });

    process.on('SIGINT', () => {
      void app.close();
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
