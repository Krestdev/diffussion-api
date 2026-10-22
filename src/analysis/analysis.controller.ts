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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RequirePermission } from '../auth/rbac/require-permission.decorator';
import {
  SiteScope,
  fromBody,
  fromParam,
} from '../auth/rbac/site-scope.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { AnalysisSheetService } from './analysis-sheet.service';
import {
  CreateAnalysisItemDto,
  CreateAnalysisSheetDto,
  DecideAnalysisSheetDto,
  FindAnalysisSheetsQueryDto,
  SetCriteriaDto,
  UpdateAnalysisItemDto,
  UpdateAnalysisSheetDto,
} from './dto/analysis.dto';

@ApiTags('analysis-sheets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
// Permissions are checked at the site of the targeted resource.
@SiteScope(fromParam('analysisSheet'))
@Controller('analysis-sheets')
export class AnalysisController {
  constructor(private readonly sheets: AnalysisSheetService) {}

  @Post()
  @RequirePermission(PermissionCode.AnalysisCreate)
  @SiteScope(fromBody('courrier', 'courrierId'))
  create(@Body() dto: CreateAnalysisSheetDto, @CurrentUser() user: JwtPayload) {
    return this.sheets.create(dto, user.sub);
  }

  @Get()
  @RequirePermission(PermissionCode.AnalysisRead)
  findAll(
    @Query() query: FindAnalysisSheetsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sheets.findAll(query, user.sub);
  }

  @Get(':id')
  @RequirePermission(PermissionCode.AnalysisRead)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sheets.findOne(id);
  }

  /** Récapitulatif: one line per element with its avis (spec §8). */
  @Get(':id/summary')
  @RequirePermission(PermissionCode.AnalysisRead)
  summary(@Param('id', ParseUUIDPipe) id: string) {
    return this.sheets.summary(id);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.AnalysisUpdate)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAnalysisSheetDto,
  ) {
    return this.sheets.update(id, dto);
  }

  @Post(':id/items')
  @RequirePermission(PermissionCode.AnalysisUpdate)
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAnalysisItemDto,
  ) {
    return this.sheets.addItem(id, dto);
  }

  @Patch('items/:itemId')
  @RequirePermission(PermissionCode.AnalysisUpdate)
  @SiteScope(fromParam('analysisItem', 'itemId'))
  updateItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateAnalysisItemDto,
  ) {
    return this.sheets.updateItem(itemId, dto);
  }

  @Delete('items/:itemId')
  @SiteScope(fromParam('analysisItem', 'itemId'))
  @RequirePermission(PermissionCode.AnalysisUpdate)
  removeItem(@Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.sheets.removeItem(itemId);
  }

  /** Full-replace of one element's criteria grid. */
  @Put('items/:itemId/criteria')
  @RequirePermission(PermissionCode.AnalysisUpdate)
  @SiteScope(fromParam('analysisItem', 'itemId'))
  setCriteria(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SetCriteriaDto,
  ) {
    return this.sheets.setCriteria(itemId, dto);
  }

  /** The author hands the fiche over for validation. */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionCode.AnalysisUpdate)
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sheets.submit(id, user.sub);
  }

  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionCode.AnalysisDecide)
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideAnalysisSheetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sheets.decide(id, dto, user.sub);
  }
}
