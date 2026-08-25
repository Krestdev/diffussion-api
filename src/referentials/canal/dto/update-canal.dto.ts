import { PartialType } from '@nestjs/swagger';
import { CreateCanalDto } from './create-canal.dto';

export class UpdateCanalDto extends PartialType(CreateCanalDto) {}
