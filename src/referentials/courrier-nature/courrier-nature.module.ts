import { Module } from '@nestjs/common';
import { CourrierNatureService } from './courrier-nature.service';
import { CourrierNatureController } from './courrier-nature.controller';

@Module({
  controllers: [CourrierNatureController],
  providers: [CourrierNatureService],
})
export class CourrierNatureModule {}
