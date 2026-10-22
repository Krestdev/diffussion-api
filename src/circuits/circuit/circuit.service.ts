import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateCircuitDto } from './dto/create-circuit.dto';
import { UpdateCircuitDto } from './dto/update-circuit.dto';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../../common/dto/pagination.query.dto';

const include = {
  dossierType: true,
  role: true,
  steps: { orderBy: { order: 'asc' } },
} satisfies Prisma.CircuitInclude;

@Injectable()
export class CircuitService {
  constructor(private readonly database: DatabaseService) {}

  async create(dto: CreateCircuitDto) {
    await this.assertReferencesExist(dto);
    return this.database.circuit.create({ data: dto, include });
  }

  async findAll(query: PaginationQueryDto = {}) {
    const where: Prisma.CircuitWhereInput = {
      name: query.search
        ? { contains: query.search, mode: 'insensitive' }
        : undefined,
    };
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;

    const [data, total] = await this.database.$transaction([
      this.database.circuit.findMany({
        where,
        orderBy: { name: 'asc' },
        include,
        skip,
        take,
      }),
      this.database.circuit.count({ where }),
    ]);

    return { data, total, skip, take };
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
    await this.assertCircuitUnused(id);
    await this.assertReferencesExist(dto);
    return this.database.circuit.update({ where: { id }, data: dto, include });
  }

  // Checked up front so a bad id says *which* one is wrong, instead of
  // surfacing as a bare foreign-key violation.
  private async assertReferencesExist(dto: {
    dossierTypeId?: string;
    roleId?: string;
  }) {
    if (dto.dossierTypeId) {
      const dossierType = await this.database.dossierType.findUnique({
        where: { id: dto.dossierTypeId },
        select: { id: true },
      });
      if (!dossierType) {
        throw new BadRequestException(
          `Dossier type ${dto.dossierTypeId} not found`,
        );
      }
    }
    if (dto.roleId) {
      const role = await this.database.role.findUnique({
        where: { id: dto.roleId },
        select: { id: true },
      });
      if (!role) {
        throw new BadRequestException(`Role ${dto.roleId} not found`);
      }
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.assertCircuitUnused(id);
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

  /**
   * RG-CIR-IMMUT: mirrors the same guard in CircuitStepService — the
   * circuit itself cannot be edited or deleted while runs are active.
   */
  private async assertCircuitUnused(circuitId: string) {
    const running = await this.database.circuitInstance.count({
      where: { circuitId, status: 'IN_PROGRESS' },
    });
    if (running > 0) {
      throw new BadRequestException(
        `This circuit has ${running} in-progress instance(s) — it cannot be modified or deleted while runs are active. Create a new circuit and assign it to the dossier type instead.`,
      );
    }
  }
}
