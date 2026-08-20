import { Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { DeliverableService } from './deliverable.service';

export class DeliverableController {
  constructor(private readonly DeliverableService: DeliverableService) {}

  @Post()
  createDeliverable() {
    return 'create deliverable';
  }

  @Get()
  findAllDeliverable() {
    return 'find all deliverable';
  }

  @Get(':id')
  findDeliverableById(@Param('id') id: string) {
    return 'find deliverable by id';
  }

  @Patch(':id')
  updateDeliverable(@Param('id') id: string) {
    return 'update deliverable';
  }

  @Delete(':id')
  deleteDeliverable(@Param('id') id: string) {
    return 'delete deliverable';
  }
}
