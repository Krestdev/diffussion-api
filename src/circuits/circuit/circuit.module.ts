import { Module } from '@nestjs/common';
import { CircuitService } from './circuit.service';
import { CircuitController } from './circuit.controller';

@Module({
  controllers: [CircuitController],
  providers: [CircuitService],
})
export class CircuitModule {}
