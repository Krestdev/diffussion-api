import { Module } from '@nestjs/common';
import { AnalysisController } from './analysis.controller';
import { AnalysisSheetService } from './analysis-sheet.service';
import { CriterionTemplateController } from './criterion-template.controller';
import { CriterionTemplateService } from './criterion-template.service';

@Module({
  controllers: [AnalysisController, CriterionTemplateController],
  providers: [AnalysisSheetService, CriterionTemplateService],
  exports: [AnalysisSheetService],
})
export class AnalysisModule {}
