import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateContractDto } from './create-contract.dto';

// Who may open the contract is changed through PUT /contracts/:id/access.
export class UpdateContractDto extends PartialType(
  OmitType(CreateContractDto, ['authorizedUserIds'] as const),
) {}
