import { Module } from '@nestjs/common';
import { DomainModule } from '../domain/domain.module';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [DomainModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
