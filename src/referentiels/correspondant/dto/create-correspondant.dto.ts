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
  type?: string;

  @ApiPropertyOptional({ example: 'Yaoundé' })
  @IsOptional()
  @IsString()
  ville?: string;

  @ApiPropertyOptional({ example: 'actif' })
  @IsOptional()
  @IsString()
  status?: string;
}
