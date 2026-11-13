import { COURRIER_STATUS_DOC } from './courrier-status.doc';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';
import { CourrierDirection, CourrierStatus } from 'generated/prisma/enums';

export class FindMailsQueryDto {
  @ApiPropertyOptional({
    description:
      'Search in the subject, number, printed reference or correspondent name',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description:
      "Only this site's effets — within those the caller may already see",
  })
  @IsOptional()
  @IsUUID('4')
  siteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  dossierId?: string;

  @ApiPropertyOptional({
    description: 'Only the courriers whose dossier is in this project',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Only the courriers whose dossier is under this contract',
  })
  @IsOptional()
  @IsUUID()
  contractId?: string;

  @ApiPropertyOptional({ enum: CourrierDirection })
  @IsOptional()
  @IsEnum(CourrierDirection)
  direction?: CourrierDirection;

  @ApiPropertyOptional({
    enum: CourrierStatus,
    description: COURRIER_STATUS_DOC,
  })
  @IsOptional()
  @IsEnum(CourrierStatus)
  status?: CourrierStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  correspondentId?: string;

  @ApiPropertyOptional({ description: 'Effet type' })
  @IsOptional()
  @IsUUID()
  typeId?: string;

  // Person in charge — used by the "Affectations" queue (courriers
  // assigned to me), distinct from filtering by who created the courrier.
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  skip?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  take?: number;
}
