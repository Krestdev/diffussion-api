import { Module } from '@nestjs/common';
import { CorrespondentTypeService } from './correspondent-type.service';
import { CorrespondentTypeController } from './correspondent-type.controller';

@Module({
  controllers: [CorrespondentTypeController],
  providers: [CorrespondentTypeService],
})
export class CorrespondentTypeModule {}
