import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class ApproveSelectedLivrablesDto {
  @ApiProperty({
    type: [String],
    description: 'Liste des identifiants des livrables à valider',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  livrableIds: string[];
}
