import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateCircuitStepDto } from './create-circuit-step.dto';

export class UpdateCircuitStepDto extends PartialType(
  OmitType(CreateCircuitStepDto, ['circuitId'] as const),
) {}
