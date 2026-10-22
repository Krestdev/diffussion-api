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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
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
import { UpdateMailDto } from './dto/update-mail.dto';
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

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMailDto) {
    return this.mailService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.remove(id);
  }

  @Post(':id/transmit')
  @RequirePermission(PermissionCode.CourrierRead)
  transmit(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.transmit(id);
  }

  // Starts the courrier's validation Circuit — see
  // CircuitInstanceService.start() / MailService.submitForVerification().
  // Actual step-by-step decisions happen on the CircuitInstance resource
  // (POST /circuit-instances/:id/decide), not here.
  @Post(':id/submit-for-verification')
  @RequirePermission(PermissionCode.CourrierWriteSortant)
  submitForVerification(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.submitForVerification(id, user.sub);
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
