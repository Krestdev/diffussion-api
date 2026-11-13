import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';

export class DeposerLivrablesDto {
  @ApiProperty({
    description:
      'Chaîne JSON représentant la liste des livrables à déposer avec leurs fichiers : [{"livrableId": "uuid-1", "files": ["f0"]}]',
    example:
      '[{"livrableId":"uuid-1","files":["f0"]},{"livrableId":"uuid-2","files":["f1","f2"]}]',
  })
  @IsDefined()
  livrables: string | Array<{ livrableId: string; files: string[] }>;

  @ApiPropertyOptional({
    description:
      "Commentaire de l'agent pour le superviseur, enregistré sur chaque livrable déposé",
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  agentComment?: string;
}
