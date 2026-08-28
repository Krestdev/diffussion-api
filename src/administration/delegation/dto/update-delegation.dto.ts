import { PartialType } from '@nestjs/swagger';
import { CreateDelegationDto } from './create-delegation.dto';

export class UpdateDelegationDto extends PartialType(CreateDelegationDto) {}
