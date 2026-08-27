import { Module } from '@nestjs/common';
import { CircuitModule } from './circuit/circuit.module';
import { CircuitStepModule } from './circuit-step/circuit-step.module';
import { CircuitInstanceModule } from './circuit-instance/circuit-instance.module';

@Module({
  imports: [CircuitModule, CircuitStepModule, CircuitInstanceModule],
  exports: [CircuitInstanceModule],
})
export class CircuitsModule {}
