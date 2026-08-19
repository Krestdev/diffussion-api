import { PartialType } from '@nestjs/swagger';
import { CreateInstructionsDto } from './create-instruction.dto';

export class UpdateInstructionDto extends PartialType(CreateInstructionsDto) {}
