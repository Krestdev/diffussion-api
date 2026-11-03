import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RequirePermission } from '../auth/rbac/require-permission.decorator';
import { CriterionTemplateService } from './criterion-template.service';
import {
  CreateCriterionTemplateDto,
  UpdateAnalysisSettingsDto,
  UpdateCriterionTemplateDto,
} from './dto/analysis.dto';

// Reading the grid is open to anyone who may read a fiche — the frontend
// needs it to render the form. Editing it is an administration act.
@ApiTags('analysis-criteria')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('analysis-criteria')
export class CriterionTemplateController {
  constructor(private readonly templates: CriterionTemplateService) {}

  @Post()
  @RequirePermission(PermissionCode.AdminManageAnalysisCriteria)
  create(@Body() dto: CreateCriterionTemplateDto) {
    return this.templates.create(dto);
  }

  @Get()
  @RequirePermission(PermissionCode.AnalysisRead)
  findAll() {
    return this.templates.findAll();
  }

  // Declared before ':id' so "settings" isn't parsed as an id.
  @Get('settings')
  @RequirePermission(PermissionCode.AnalysisRead)
  getSettings() {
    return this.templates.getSettings();
  }

  @Patch('settings')
  @RequirePermission(PermissionCode.AdminManageAnalysisCriteria)
  updateSettings(@Body() dto: UpdateAnalysisSettingsDto) {
    return this.templates.updateSettings(dto);
  }

  @Get(':id')
  @RequirePermission(PermissionCode.AnalysisRead)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.findOne(id);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.AdminManageAnalysisCriteria)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCriterionTemplateDto,
  ) {
    return this.templates.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.AdminManageAnalysisCriteria)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(id);
  }
}
