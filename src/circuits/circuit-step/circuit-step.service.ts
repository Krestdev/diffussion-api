import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { CreateCircuitStepDto } from './dto/create-circuit-step.dto';
import { UpdateCircuitStepDto } from './dto/update-circuit-step.dto';

const include = { role: true } satisfies Prisma.CircuitStepInclude;

@Injectable()
export class CircuitStepService {
  constructor(private readonly database: DatabaseService) {}

  async create(dto: CreateCircuitStepDto) {
    await this.assertCircuitExists(dto.circuitId);
    await this.assertCircuitUnused(dto.circuitId);
    await this.assertRoleExists(dto.roleId);
    await this.assertOrderFree(dto.circuitId, dto.order);
    await this.assertParentValid(dto.circuitId, dto.parentStepId, dto.order);
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
    // `circuitId` is not updatable (see UpdateCircuitStepDto): a step keeps
    // the circuit it was created in.
    const step = await this.findOne(id);
    await this.assertCircuitUnused(step.circuitId);
    await this.assertRoleExists(dto.roleId);

    const order = dto.order ?? step.order;
    const parentStepId =
      dto.parentStepId === undefined ? step.parentStepId : dto.parentStepId;

    if (order !== step.order) {
      await this.assertOrderFree(step.circuitId, order, id);
      await this.assertChildrenStayLater(id, order);
    }
    await this.assertParentValid(step.circuitId, parentStepId, order, id);

    return this.database.circuitStep.update({
      where: { id },
      data: dto,
      include,
    });
  }

  async remove(id: string) {
    const step = await this.findOne(id);
    await this.assertCircuitUnused(step.circuitId);
    await this.database.circuitStep.delete({ where: { id } });
  }

  private async assertCircuitExists(circuitId: string) {
    const circuit = await this.database.circuit.findUnique({
      where: { id: circuitId },
      select: { id: true },
    });
    if (!circuit) {
      throw new BadRequestException(`Circuit ${circuitId} not found`);
    }
  }

  /**
   * RG-CIR-IMMUT: a circuit template whose steps are actively being followed
   * by one or more in-progress instances cannot be modified. To change a
   * workflow, create a new circuit and assign it to the dossier type —
   * running instances will finish on the old, now-frozen template.
   */
  private async assertCircuitUnused(circuitId: string) {
    const running = await this.database.circuitInstance.count({
      where: { circuitId, status: 'IN_PROGRESS' },
    });
    if (running > 0) {
      throw new BadRequestException(
        `This circuit has ${running} in-progress instance(s) — its steps cannot be modified while runs are active. Create a new circuit and assign it to the dossier type instead.`,
      );
    }
  }

  private async assertRoleExists(roleId?: string | null) {
    if (!roleId) return;
    const role = await this.database.role.findUnique({
      where: { id: roleId },
      select: { id: true },
    });
    if (!role) {
      throw new BadRequestException(`Role ${roleId} not found`);
    }
  }

  // "Next step" is the lowest order above the current one, so two steps
  // sharing a position make the path taken arbitrary.
  private async assertOrderFree(
    circuitId: string,
    order: number,
    ignoreStepId?: string,
  ) {
    const clash = await this.database.circuitStep.findFirst({
      where: {
        circuitId,
        order,
        id: ignoreStepId ? { not: ignoreStepId } : undefined,
      },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(
        `Another step of this circuit already has order ${order}`,
      );
    }
  }

  /**
   * `parentStepId` is where a rejection falls back to, so it must be an
   * earlier step of the same circuit. A forward (or cross-circuit) target
   * would send a rejected instance onwards for ever.
   */
  private async assertParentValid(
    circuitId: string,
    parentStepId: string | null | undefined,
    order: number,
    selfId?: string,
  ) {
    if (!parentStepId) return;
    if (selfId && parentStepId === selfId) {
      throw new BadRequestException(
        'A step cannot be its own rejection target',
      );
    }
    const parent = await this.database.circuitStep.findUnique({
      where: { id: parentStepId },
      select: { circuitId: true, order: true },
    });
    if (!parent) {
      throw new BadRequestException(`Parent step ${parentStepId} not found`);
    }
    if (parent.circuitId !== circuitId) {
      throw new BadRequestException(
        'The rejection target must belong to the same circuit',
      );
    }
    if (parent.order >= order) {
      throw new BadRequestException(
        `The rejection target must be an earlier step (its order ${parent.order} must be below ${order})`,
      );
    }
  }

  // Symmetric check when a step moves: the steps that fall back to it must
  // still sit after it.
  private async assertChildrenStayLater(stepId: string, newOrder: number) {
    const children = await this.database.circuitStep.findMany({
      where: { parentStepId: stepId, order: { lte: newOrder } },
      select: { order: true },
    });
    if (children.length > 0) {
      throw new BadRequestException(
        `Order ${newOrder} would place this step at or after step(s) ${children
          .map((c) => c.order)
          .join(', ')} that fall back to it on rejection`,
      );
    }
  }
}
