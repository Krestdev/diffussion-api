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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RequirePermission } from '../auth/rbac/require-permission.decorator';
import { CriterionTemplateService } from './criterion-template.service';
import {
  CreateCriterionTemplateDto,
  UpdateAnalysisSettingsDto,
  UpdateCriterionTemplateDto,
  AnalysisSettingsQueryDto,
  FindCriteriaQueryDto,
} from './dto/analysis.dto';

// Reading the grid is open to anyone who may read a fiche — the frontend
// needs it to render the form. Editing it is an administration act: the
// common criteria by a platform administrator, a site's own by whoever
// manages its criteria (checked in the service).
@ApiTags('analysis-criteria')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('analysis-criteria')
export class CriterionTemplateController {
  constructor(private readonly templates: CriterionTemplateService) {}

  @Post()
  create(
    @Body() dto: CreateCriterionTemplateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.templates.create(dto, user.sub);
  }

  // ?siteId=: what a fiche of that site offers (common + its own).
  @Get()
  @RequirePermission(PermissionCode.AnalysisRead)
  findAll(
    @Query() query: FindCriteriaQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.templates.findAll(query, user.sub);
  }

  // Declared before ':id' so "settings" isn't parsed as an id.
  @Get('settings')
  @RequirePermission(PermissionCode.AnalysisRead)
  getSettings(@Query() query: AnalysisSettingsQueryDto) {
    return this.templates.getSettings(query.siteId);
  }

  @Patch('settings')
  updateSettings(
    @Body() dto: UpdateAnalysisSettingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.templates.updateSettings(dto, user.sub);
  }

  @Get(':id')
  @RequirePermission(PermissionCode.AnalysisRead)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCriterionTemplateDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.templates.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.templates.remove(id, user.sub);
  }
}
