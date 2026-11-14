import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class SetLanguageDto {
  @ApiProperty({
    example: 'fr',
    description: 'A language code, e.g. "fr" or "pt-BR"',
  })
  @Matches(/^[a-z]{2,3}(-[A-Z]{2})?$/)
  language: string;
}
