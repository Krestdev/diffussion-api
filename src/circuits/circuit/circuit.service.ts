import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateCircuitDto } from './dto/create-circuit.dto';
import { UpdateCircuitDto } from './dto/update-circuit.dto';

const include = {
  dossierType: true,
  role: true,
  steps: { orderBy: { order: 'asc' } },
} satisfies Prisma.CircuitInclude;

@Injectable()
export class CircuitService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateCircuitDto) {
    return this.database.circuit.create({ data: dto, include });
  }

  findAll() {
    return this.database.circuit.findMany({
      orderBy: { name: 'asc' },
      include,
    });
  }

  async findOne(id: string) {
    const circuit = await this.database.circuit.findUnique({
      where: { id },
      include,
    });
    if (!circuit) {
      throw new NotFoundException(`Circuit ${id} not found`);
    }
    return circuit;
  }

  async update(id: string, dto: UpdateCircuitDto) {
    await this.findOne(id);
    return this.database.circuit.update({ where: { id }, data: dto, include });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.database.circuit.delete({ where: { id } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException(
          'Circuit still has steps or materialized instances',
        );
      }
      throw error;
    }
  }
}
