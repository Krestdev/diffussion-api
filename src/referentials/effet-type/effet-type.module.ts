import { Module } from '@nestjs/common';
import { EffetTypeController } from './effet-type.controller';
import { EffetTypeService } from './effet-type.service';

@Module({
  controllers: [EffetTypeController],
  providers: [EffetTypeService],
})
export class EffetTypeModule {}
