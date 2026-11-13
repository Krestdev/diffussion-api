import { Module } from '@nestjs/common';
import { SettingsModule } from '../administration/settings/settings.module';
import { AnalysisController } from './analysis.controller';
import { AnalysisSheetService } from './analysis-sheet.service';
import { CriterionTemplateController } from './criterion-template.controller';
import { CriterionTemplateService } from './criterion-template.service';

@Module({
  // The documents' identity (logo, colour) for the fiches' PDF.
  imports: [SettingsModule],
  controllers: [AnalysisController, CriterionTemplateController],
  providers: [AnalysisSheetService, CriterionTemplateService],
  exports: [AnalysisSheetService],
})
export class AnalysisModule {}
