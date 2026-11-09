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
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import {
  ATTACHMENT_RULE,
  attachmentUploadOptions,
} from '../../common/utils/attachment-upload';
import { RestoreNoteDto } from '../../common/dto/restore-note.dto';
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
import { ArchiveReasonDto } from '../../common/dto/archive-reason.dto';
import { CancelMailDto } from './dto/cancel-mail.dto';
import { CloseMailDto } from './dto/close-mail.dto';
import { DischargeMailDto } from './dto/discharge-mail.dto';
import { SendMailDto } from './dto/send-mail.dto';
import { SignMailDto } from './dto/sign-mail.dto';
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
          description: `Document files to attach to this courrier (${ATTACHMENT_RULE})`,
        },
        documents: {
          type: 'string',
          description:
            'Document metadata JSON string (e.g. [{"name": "Facture"}]) matching the order of uploaded files',
        },
      },
    },
  })
  @UseInterceptors(FilesInterceptor('files', 10, attachmentUploadOptions()))
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

  // Only what the caller may see: their sites' effets (see
  // visibleMailsWhere), like the entrants / sortants lists.
  @Get()
  @RequirePermission(PermissionCode.CourrierRead)
  findAll(
    @Query() query: FindMailsQueryDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.findAll(query, user.sub);
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

  // Same filters as GET /courriers/sortants, every page.
  @Get('sortants/export')
  @RequirePermission(PermissionCode.CourrierRead)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportOutgoing(
    @Query() query: FindOutgoingMailsQueryDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
    @Res() res: Response,
  ) {
    const csv = await this.mailService.exportOutgoing(query, user.sub);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="effets-sortants.csv"',
    );
    res.end(csv);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.findOneDetailed(id, user.sub);
  }

  // The PDF of an authorized sortant (VALIDE, SIGNE, ENVOYE, DECHARGE, or
  // archived from one of them), with its SOR reference.
  @Get(':id/pdf')
  @RequirePermission(PermissionCode.CourrierRead)
  @Header('Content-Type', 'application/pdf')
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
    @Res() res: Response,
  ) {
    const { pdf, filename } = await this.mailService.outgoingPdf(id, user.sub);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(pdf);
  }

  // The bordereau de transmission (model S·12) of a sent sortant.
  @Get(':id/bordereau')
  @RequirePermission(PermissionCode.CourrierRead)
  @Header('Content-Type', 'application/pdf')
  async bordereau(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
    @Res() res: Response,
  ) {
    const { pdf, filename } = await this.mailService.bordereauPdf(id, user.sub);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(pdf);
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

  // VALIDE -> SIGNE: the signed scan, its signatory, its date.
  @Post(':id/sign')
  @RequirePermission(PermissionCode.CourrierSend)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'signatoryId', 'signedAt'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: `The signed scan (${ATTACHMENT_RULE})`,
        },
        signatoryId: { type: 'string', format: 'uuid' },
        signedAt: { type: 'string', format: 'date', example: '2026-11-02' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', attachmentUploadOptions()))
  sign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SignMailDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.sign(id, dto, file, user.sub);
  }

  // SIGNE -> ENVOYE, under a new bordereau BT-AAAA-NNNNNN.
  @Post(':id/send')
  @RequirePermission(PermissionCode.CourrierSend)
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMailDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.send(id, dto, user.sub);
  }

  // A sortant needs its reason ({ reason }, 10 characters at least).
  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelMailDto) {
    return this.mailService.cancel(id, dto?.reason);
  }

  // Its open instructions are cancelled with it. Optional { note }. By its
  // designated responsible, its supervisor, its site's responsible, a
  // platform administrator, or COURRIER_CLOSE at its site — checked in the
  // service.
  @Post(':id/close')
  @RequirePermission(PermissionCode.CourrierRead)
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseMailDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.close(id, dto, user.sub);
  }

  // An entrant once CLOTURE; a sortant once DECHARGE or ANNULE. Optional
  // { reason }.
  @Post(':id/archive')
  @RequirePermission(PermissionCode.CourrierRead)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ArchiveReasonDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.archive(id, dto?.reason, user.sub);
  }

  @Post(':id/unarchive')
  @RequirePermission(PermissionCode.CourrierRead)
  unarchive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RestoreNoteDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.unarchive(id, user.sub, dto.note);
  }

  // A physical effet expected back is handed back — physical custody is the
  // reception's job, hence the registration permission.
  @Post(':id/return')
  @RequirePermission(PermissionCode.CourrierRegisterEntrant)
  markReturned(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.markReturned(id);
  }

  // A sent sortant: ENVOYE -> DECHARGE, multipart with the discharged
  // bordereau (`file`), `receivedBy` and `dischargedAt`. An entrant: the
  // décharge handed at reception, no body.
  @Post(':id/discharge')
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: `The discharged bordereau (${ATTACHMENT_RULE})`,
        },
        receivedBy: { type: 'string', maxLength: 255 },
        dischargedAt: {
          type: 'string',
          format: 'date',
          example: '2026-11-02',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', attachmentUploadOptions()))
  discharge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DischargeMailDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.discharge(id, user.sub, dto, file);
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
