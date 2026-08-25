import { Injectable } from '@nestjs/common';
import { CreateCircuitStepDto } from './dto/create-circuit-step.dto';
import { UpdateCircuitStepDto } from './dto/update-circuit-step.dto';

@Injectable()
export class CircuitStepService {
  create(createCircuitStepDto: CreateCircuitStepDto) {
    return 'This action adds a new circuitStep';
  }

  findAll() {
    return `This action returns all circuitStep`;
  }

  findOne(id: number) {
    return `This action returns a #${id} circuitStep`;
  }

  update(id: number, updateCircuitStepDto: UpdateCircuitStepDto) {
    return `This action updates a #${id} circuitStep`;
  }

  remove(id: number) {
    return `This action removes a #${id} circuitStep`;
  }
}
