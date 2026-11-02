import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import {
  SiteScope,
  fromBody,
  fromParam,
} from '../../auth/rbac/site-scope.decorator';
import { JwtPayloadWithRefreshToken } from '../../auth/types/jwt-payload.type';
import { SetAccessDto } from '../../common/dto/access.dto';
import { SetOwnerDto } from '../../common/dto/set-owner.dto';
import { CreateMailDto } from './dto/create-mail.dto';
import { CreateOutgoingMailDto } from './dto/create-outgoing-mail.dto';
import { FindIncomingMailsQueryDto } from './dto/find-incoming-mails.query.dto';
import { FindMailsQueryDto } from './dto/find-mails.query.dto';
import { FindOutgoingMailsQueryDto } from './dto/find-outgoing-mails.query.dto';
import { RequestCorrectionsDto } from './dto/request-corrections.dto';
import { UpdateMailDto } from './dto/update-mail.dto';
import { DispatchMailDto } from './dto/dispatch-mail.dto';
import { AssignSupervisorDto } from './dto/assign-supervisor.dto';
import { MailService } from './mail.service';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@ApiTags('courriers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
// Permissions are checked at the site of the targeted resource.
@SiteScope(fromParam('courrier'))
@Controller('courriers')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post()
  @RequirePermission(PermissionCode.CourrierRegisterEntrant)
  @SiteScope(fromBody('dossier', 'dossierId'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['dossierId', 'direction', 'subject'],
      properties: {
        dossierId: { type: 'string', format: 'uuid' },
        direction: { type: 'string', enum: ['ENTRANT', 'SORTANT'] },
        subject: { type: 'string' },
        correspondentId: { type: 'string', format: 'uuid' },
        natureId: { type: 'string', format: 'uuid' },
        canalId: { type: 'string', format: 'uuid' },
        reference: { type: 'string', maxLength: 60 },
        copies: { type: 'integer', minimum: 1 },
        receivedAt: { type: 'string', format: 'date-time' },
        scanUrl: { type: 'string' },
        ownerId: { type: 'string', format: 'uuid' },
        respondsToId: { type: 'string', format: 'uuid' },
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Document files to attach to this courrier',
        },
        documents: {
          type: 'string',
          description:
            'Document metadata JSON string (e.g. [{"name": "Facture"}]) matching the order of uploaded files',
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  create(
    @Body() dto: CreateMailDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.mailService.create(dto, user.sub, files);
  }

  // Sortant draft from its subject alone — returns its generated number,
  // in BROUILLON; the rest is filled in through PATCH /courriers/:id.
  @Post('sortants')
  @RequirePermission(PermissionCode.CourrierWriteSortant)
  createOutgoing(
    @Body() dto: CreateOutgoingMailDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.createOutgoingDraft(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindMailsQueryDto) {
    return this.mailService.findAll(query);
  }

  // Declared before @Get(':id') so "entrants" isn't parsed as an id.
  @Get('entrants')
  @RequirePermission(PermissionCode.CourrierRead)
  findIncoming(
    @Query() query: FindIncomingMailsQueryDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.findIncoming(query, user.sub);
  }

  @Get('sortants')
  @RequirePermission(PermissionCode.CourrierRead)
  findOutgoing(
    @Query() query: FindOutgoingMailsQueryDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.findOutgoing(query, user.sub);
  }

  // The caller's validation inbox.
  @Get('awaiting-my-validation')
  findAwaitingMyValidation(@CurrentUser() user: JwtPayloadWithRefreshToken) {
    return this.mailService.findAwaitingMyValidation(user.sub);
  }

  // Declared before @Get(':id') so static segments aren't parsed as UUIDs.
  @Get('entrants/export')
  @RequirePermission(PermissionCode.CourrierRead)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportIncoming(
    @Query() query: FindIncomingMailsQueryDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
    @Res() res: Response,
  ) {
    const csv = await this.mailService.exportIncoming(query, user.sub);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="effets-entrants.csv"',
    );
    res.end(csv);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.findOne(id);
  }

  @Get(':id/historique')
  @RequirePermission(PermissionCode.CourrierRead)
  historique(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.mailService.historique(
      id,
      user.sub,
      skip ? parseInt(skip, 10) : 0,
      take ? parseInt(take, 10) : 20,
    );
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMailDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.remove(id);
  }

  @Post(':id/transmit')
  @RequirePermission(PermissionCode.CourrierRead)
  transmit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.transmit(id, user.sub);
  }

  @Post(':id/dispatch')
  @RequirePermission(PermissionCode.CourrierRead)
  dispatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DispatchMailDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.dispatch(id, dto, user.sub);
  }

  @Post(':id/dispatch/validate')
  @RequirePermission(PermissionCode.CourrierDispatchValidate)
  validateDispatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.validateDispatch(id, user.sub);
  }

  @Post(':id/supervisor')
  @RequirePermission(PermissionCode.CourrierRead)
  assignSupervisor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignSupervisorDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.assignSupervisor(id, dto, user.sub);
  }

  // Sends the courrier to its validator (the dossier's responsible, or the
  // site's), who then validates it or asks for corrections below.
  @Post(':id/submit-for-validation')
  @RequirePermission(PermissionCode.CourrierWriteSortant)
  submitForValidation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.submitForValidation(id, user.sub);
  }

  // By designation, not by role: only the courrier's validator may decide
  // — checked in MailService.
  @Post(':id/validate')
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.validate(id, user.sub);
  }

  @Post(':id/request-corrections')
  requestCorrections(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestCorrectionsDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.requestCorrections(id, dto.motif, user.sub);
  }

  @Post(':id/send')
  @RequirePermission(PermissionCode.CourrierSend)
  send(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.send(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.cancel(id);
  }

  @Post(':id/close')
  @RequirePermission(PermissionCode.CourrierRead)
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.close(id);
  }

  @Post(':id/archive')
  @RequirePermission(PermissionCode.CourrierRead)
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.archive(id);
  }

  @Post(':id/unarchive')
  @RequirePermission(PermissionCode.CourrierRead)
  unarchive(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.unarchive(id);
  }

  // A physical effet expected back is handed back — physical custody is the
  // reception's job, hence the registration permission.
  @Post(':id/return')
  @RequirePermission(PermissionCode.CourrierRegisterEntrant)
  markReturned(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.markReturned(id);
  }

  @Post(':id/discharge')
  discharge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.discharge(id, user.sub);
  }

  // Authorization (creator / site responsible / platform admin) is enforced
  // inside MailService.setOwner — no blanket @RequirePermission here.
  @Patch(':id/owner')
  setOwner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOwnerDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.setOwner(id, dto, user.sub);
  }

  @Get(':id/access')
  @RequirePermission(PermissionCode.CourrierRead)
  getAccess(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.getAccess(id);
  }

  @Put(':id/access')
  @RequirePermission(PermissionCode.CourrierRead)
  setAccess(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetAccessDto) {
    return this.mailService.setAccess(id, dto);
  }
}
