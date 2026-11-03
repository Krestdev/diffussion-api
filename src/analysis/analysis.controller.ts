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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Header,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ArchiveReasonDto } from '../common/dto/archive-reason.dto';
import { attachmentUploadOptions } from '../common/utils/attachment-upload';
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
  NewAnalysisVersionDto,
  SetCriteriaDto,
  SignAnalysisSheetDto,
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

  @Get(':id/pdf')
  @RequirePermission(PermissionCode.AnalysisRead)
  @Header('Content-Type', 'application/pdf')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { pdf, filename } = await this.sheets.pdf(id);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(pdf);
  }

  // A draft (BROUILLON) only.
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.AnalysisUpdate)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.sheets.remove(id);
  }

  // BROUILLON or ENREGISTREE -> SIGNEE, locked: the signed PDF, its
  // signatory, its date.
  @Post(':id/sign')
  @RequirePermission(PermissionCode.AnalysisUpdate)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'signatoryName', 'signedAt'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF' },
        signatoryName: { type: 'string', maxLength: 255 },
        signedAt: { type: 'string', format: 'date', example: '2026-11-02' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', attachmentUploadOptions()))
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignAnalysisSheetDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.sheets.sign(id, dto, file, user.sub);
  }

  // From an ENREGISTREE or SIGNEE fiche: a new BROUILLON, elements and
  // criteria copied.
  @Post(':id/new-version')
  @RequirePermission(PermissionCode.AnalysisUpdate)
  newVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NewAnalysisVersionDto,
  ) {
    return this.sheets.newVersion(id, dto);
  }

  @Post(':id/archive')
  @RequirePermission(PermissionCode.AnalysisUpdate)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveReasonDto,
  ) {
    return this.sheets.archive(id, dto?.reason);
  }

  @Post(':id/unarchive')
  @RequirePermission(PermissionCode.AnalysisUpdate)
  unarchive(@Param('id', ParseUUIDPipe) id: string) {
    return this.sheets.unarchive(id);
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
