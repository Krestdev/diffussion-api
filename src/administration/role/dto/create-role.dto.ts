import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** A role of the person's company (its company is theirs, or the core console token's). */
export class CreateRoleDto {
  @ApiProperty({ example: 'Exécutant' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({
    description: "Starts from another role's permissions",
  })
  @IsOptional()
  @IsUUID('all')
  copyFromId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Permission codes (e.g. incoming.read); the reads each action implies are added',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  permissions?: string[];
}
