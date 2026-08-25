import { PartialType } from '@nestjs/swagger';
import { CreateCircuitStepDto } from './create-circuit-step.dto';

export class UpdateCircuitStepDto extends PartialType(CreateCircuitStepDto) {}
