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
import { AuthUser } from '../auth/types/auth-user.type';
import { CoreAuthGuard } from '../auth/guards/core-auth.guard';
import { PermissionsGuard } from '../auth/access/permissions.guard';
import { Permission } from '../auth/permissions';
import { RequirePermissions } from '../auth/access/decorators';
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
// common criteria by a platform administrator, a company's own by whoever
// manages its criteria (checked in the service).
@ApiTags('analysis-criteria')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('analysis-criteria')
export class CriterionTemplateController {
  constructor(private readonly templates: CriterionTemplateService) {}

  @Post()
  create(
    @Body() dto: CreateCriterionTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templates.create(dto, user.sub);
  }

  // ?companyId=: what a fiche of that company offers (common + its own).
  @Get()
  @RequirePermissions(Permission.ANALYSIS_READ)
  findAll(@Query() query: FindCriteriaQueryDto, @CurrentUser() user: AuthUser) {
    return this.templates.findAll(query, user.sub);
  }

  // Declared before ':id' so "settings" isn't parsed as an id.
  @Get('settings')
  @RequirePermissions(Permission.ANALYSIS_READ)
  getSettings(
    @Query() query: AnalysisSettingsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templates.getSettingsFor(query.companyId, user.sub);
  }

  @Patch('settings')
  updateSettings(
    @Body() dto: UpdateAnalysisSettingsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templates.updateSettings(dto, user.sub);
  }

  @Get(':id')
  @RequirePermissions(Permission.ANALYSIS_READ)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templates.findOneFor(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCriterionTemplateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templates.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.templates.remove(id, user.sub);
  }
}
