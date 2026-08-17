import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { ServiceCreateInput } from 'generated/prisma/models';

export class CreateServiceDto implements ServiceCreateInput {
  @ApiProperty({ example: 'Service Courrier' })
  @IsString()
  @MaxLength(100)
  nom: string;
}
