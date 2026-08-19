import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CorrespondentCreateInput } from 'generated/prisma/models';

export class CreateCorrespondentDto implements CorrespondentCreateInput {
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
