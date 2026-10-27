import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateInstructionsDto } from './create-instruction.dto';

// Assignment (executants/superviseur) goes through the dedicated `assign`
// action so it stays auditable as a distinct RG-INS-002 event.
// Sub-task dependency and initial deliverables are set at creation time.
export class UpdateInstructionDto extends PartialType(
  OmitType(CreateInstructionsDto, [
    'dossierId',
    'executantIds',
    'superviseurId',
    'dependsOnId',
    'livrables',
  ] as const),
) {}
