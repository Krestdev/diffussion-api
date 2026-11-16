import { Global, Module } from '@nestjs/common';
import { WorkflowService } from './workflow.service';

/** The workflow engine (WorkflowService), available everywhere. */
@Global()
@Module({
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
