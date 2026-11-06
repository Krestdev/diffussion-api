import { Module } from '@nestjs/common';
import { ContractTypeController } from './contract-type.controller';
import { ContractTypeService } from './contract-type.service';

@Module({
  controllers: [ContractTypeController],
  providers: [ContractTypeService],
})
export class ContractTypeModule {}
