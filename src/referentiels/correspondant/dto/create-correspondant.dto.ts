import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CorrespondantCreateInput } from 'generated/prisma/models';

export class CreateCorrespondantDto implements CorrespondantCreateInput {
  @ApiPropertyOptional({ example: 'Mairie de Yaoundé' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  noms?: string;

  @ApiPropertyOptional({ example: 'institution' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  type?: string;

  @ApiPropertyOptional({ example: 'Yaoundé' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ville?: string;

  @ApiPropertyOptional({ example: 'actif' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  status?: string;
}
