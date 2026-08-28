import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateCircuitStepDto } from './dto/create-circuit-step.dto';
import { UpdateCircuitStepDto } from './dto/update-circuit-step.dto';

const include = { role: true } satisfies Prisma.CircuitStepInclude;

@Injectable()
export class CircuitStepService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateCircuitStepDto) {
    return this.database.circuitStep.create({ data: dto, include });
  }

  findAll(circuitId?: string) {
    return this.database.circuitStep.findMany({
      where: { circuitId },
      orderBy: { order: 'asc' },
      include,
    });
  }

  async findOne(id: string) {
    const step = await this.database.circuitStep.findUnique({
      where: { id },
      include,
    });
    if (!step) {
      throw new NotFoundException(`Circuit step ${id} not found`);
    }
    return step;
  }

  async update(id: string, dto: UpdateCircuitStepDto) {
    await this.findOne(id);
    return this.database.circuitStep.update({
      where: { id },
      data: dto,
      include,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.database.circuitStep.delete({ where: { id } });
  }
}
