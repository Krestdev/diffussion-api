import { ApiProperty } from '@nestjs/swagger';
import { IsDate, IsEnum, IsNotEmpty, IsString } from 'class-validator';
import {
  InstructionCreateInput,
  InstructionCreateNestedManyWithoutParentInput,
  InstructionCreateNestedOneWithoutChildrenInput,
  UserInstructionsCreateNestedManyWithoutInstructionInput,
  ValidationCreateNestedOneWithoutInstructionsInput,
  DocumentCreateNestedOneWithoutInstructionsInput,
} from 'generated/prisma/models';
import { InstructionPriorite, InstructionStatus } from 'generated/prisma/enums';

export class CreateInstructionsDto implements InstructionCreateInput {
  @ApiProperty({
    description: 'The instruction user id',
    example: 'uuid-user-1',
  })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({
    description: 'The instruction user id 2',
    example: 'uuid-user-2',
  })
  @IsString()
  @IsNotEmpty()
  userId2?: string | undefined;

  documentId?: string;
  @ApiProperty({
    description: 'The instruction label',
    example: 'transfert',
  })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({
    description: 'The instruction priorite',
    enum: InstructionPriorite,
    example: InstructionPriorite.LOW,
  })
  @IsNotEmpty()
  @IsEnum(InstructionPriorite)
  priorite: InstructionPriorite;

  @ApiProperty({
    description: 'The instruction statut',
    enum: InstructionStatus,
    example: InstructionStatus.EXECUTED,
  })
  @IsNotEmpty()
  @IsEnum(InstructionStatus)
  statut: InstructionStatus;

  @ApiProperty({
    description: 'The instruction type',
    enum: InstructionPriorite,
    example: InstructionPriorite.LOW,
  })
  @IsNotEmpty()
  @IsEnum(InstructionPriorite)
  type: InstructionPriorite;

  @ApiProperty({
    description: 'The instruction dateline',
    example: new Date(),
  })
  @IsNotEmpty()
  @IsDate()
  dateline: Date;

  @ApiProperty({
    description: 'The instruction parent id',
    example: 'uuid-instruction-1',
  })
  @IsString()
  @IsNotEmpty()
  parentId?: string | undefined;

  @ApiProperty({
    description: 'The instruction validation id',
    example: 'uuid-validation-1',
  })
  @IsString()
  @IsNotEmpty()
  validationId?: string;

  @ApiProperty({
    description: 'The instruction document',
    example: {
      id: 'uuid-document-1',
    },
  })
  @IsNotEmpty()
  document: DocumentCreateNestedOneWithoutInstructionsInput;

  @ApiProperty({
    description: 'The instruction parent',
    example: {
      id: 'uuid-instruction-1',
    },
  })
  parent?: InstructionCreateNestedOneWithoutChildrenInput | undefined;

  @ApiProperty({
    description: 'The instruction children',
    example: [
      {
        id: 'uuid-instruction-1',
      },
    ],
  })
  children?: InstructionCreateNestedManyWithoutParentInput | undefined;

  @ApiProperty({
    description: 'The instruction validation',
    example: {
      id: 'uuid-validation-1',
    },
  })
  validation?: ValidationCreateNestedOneWithoutInstructionsInput | undefined;

  @ApiProperty({
    description: 'The instruction user instructions',
    example: [
      {
        id: 'uuid-user-instruction-1',
      },
    ],
  })
  userInstructions?:
    UserInstructionsCreateNestedManyWithoutInstructionInput | undefined;
}
