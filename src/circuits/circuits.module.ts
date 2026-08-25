import { Module } from '@nestjs/common';
import { CircuitModule } from './circuit/circuit.module';
import { CircuitStepModule } from './circuit-step/circuit-step.module';

@Module({
  imports: [CircuitModule, CircuitStepModule],
})
export class CircuitsModule {}
