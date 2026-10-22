import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import {
  InstructionPriority,
  InstructionStatus,
  UserInstructionRole,
} from 'generated/prisma/enums';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';

/**
 * Tabs of the "Tâches" page. Only instructions accepted at least once
 * appear here — the pre-decision statuses belong to the Requêtes page.
 */
export const TASK_TABS = {
  'en-cours': [
    InstructionStatus.EN_COURS,
    InstructionStatus.EN_ATTENTE_VALIDATION,
    InstructionStatus.A_CORRIGER,
  ],
  terminees: [InstructionStatus.TERMINEE],
} as const satisfies Record<string, readonly InstructionStatus[]>;

export type TaskTab = keyof typeof TASK_TABS;
const TABS = Object.keys(TASK_TABS) as TaskTab[];

/**
 * Filters for GET /instructions/taches — always the caller's own tasks.
 * `search` (inherited) matches the task's number or title, or its
 * dossier's number or title. The date range applies to `createdAt` (the
 * "Reçu le" column).
 */
export class FindMyTasksQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: TABS,
    default: 'en-cours',
    description:
      'en-cours = EN_COURS, EN_ATTENTE_VALIDATION, A_CORRIGER · terminees = TERMINEE',
  })
  @IsOptional()
  @IsIn(TABS)
  tab?: TaskTab;

  @ApiPropertyOptional({
    enum: InstructionStatus,
    description: 'Exact status, within the selected tab',
  })
  @IsOptional()
  @IsEnum(InstructionStatus)
  status?: InstructionStatus;

  @ApiPropertyOptional({ enum: InstructionPriority })
  @IsOptional()
  @IsEnum(InstructionPriority)
  priority?: InstructionPriority;

  @ApiPropertyOptional({
    enum: UserInstructionRole,
    description: 'Only tasks where I am executant, or only where I supervise',
  })
  @IsOptional()
  @IsEnum(UserInstructionRole)
  role?: UserInstructionRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'Received on or after this date',
  })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description:
      'Received on or before this date (a bare date includes the whole day)',
  })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
}
