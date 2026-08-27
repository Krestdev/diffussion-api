import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsUUID, ValidateNested } from 'class-validator';

// Shared shape for the per-user access grant lists on Dossier, Courrier, and
// Document — each resource's list is independent (see the models' comments
// in schema.prisma): a grant on one is never inherited from, or propagated
// to, another.
export class AccessEntryDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiProperty()
  @IsBoolean()
  canView: boolean;

  @ApiProperty()
  @IsBoolean()
  canEdit: boolean;
}

// Full-replace semantics: the entries listed here become the complete set of
// explicit per-user grants on the resource — any existing grant for a user
// not listed is removed.
export class SetAccessDto {
  @ApiProperty({ type: [AccessEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccessEntryDto)
  entries: AccessEntryDto[];
}
