import { Module } from '@nestjs/common';
import { CircuitStepService } from './circuit-step.service';
import { CircuitStepController } from './circuit-step.controller';

@Module({
  controllers: [CircuitStepController],
  providers: [CircuitStepService],
})
export class CircuitStepModule {}
