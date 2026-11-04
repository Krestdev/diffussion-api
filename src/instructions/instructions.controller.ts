import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ATTACHMENT_MAX_BYTES } from '../common/utils/attachment-upload';
import { memoryStorage } from 'multer';
import { InstructionsService } from './instructions.service';
import { LivrableHistoryInterceptor } from './livrable-history.interceptor';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RequirePermission } from '../auth/rbac/require-permission.decorator';
import {
  SiteScope,
  fromBody,
  fromParam,
} from '../auth/rbac/site-scope.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayloadWithRefreshToken } from '../auth/types/jwt-payload.type';
import { AssignInstructionDto } from './dto/assign-instruction.dto';
import { CancelInstructionDto } from './dto/cancel-instruction.dto';
import { CloseInstructionDto } from './dto/close-instruction.dto';
import { CreateInstructionsDto } from './dto/create-instruction.dto';
import { FindInstructionsQueryDto } from './dto/find-instructions.query.dto';
import { FindMyTasksQueryDto } from './dto/find-my-tasks.query.dto';
import { FindWorkloadQueryDto } from './dto/find-workload.query.dto';
import { DeclineSubscriptionDto } from './dto/decline-subscription.dto';
import { RefuseInstructionDto } from './dto/refuse-instruction.dto';
import { SetAgentDueDateDto } from './dto/set-agent-due-date.dto';
import { UpdateInstructionDto } from './dto/update-instruction.dto';
import { ApproveSelectedLivrablesDto } from './dto/approve-selected-livrables.dto';
import { DeposerLivrablesDto } from './dto/deposer-livrables.dto';
import { RequestCorrectionsDto } from './dto/request-corrections.dto';

@ApiTags('instructions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
// Permissions are checked at the site of the targeted resource.
@SiteScope(fromParam('instruction'))
// Livrables come back as their current version, with earlier versions in
// `history` (see LivrableHistoryInterceptor).
@UseInterceptors(LivrableHistoryInterceptor)
@Controller('instructions')
export class InstructionsController {
  constructor(private readonly instructionsService: InstructionsService) {}

  @Post()
  @RequirePermission(PermissionCode.InstructionCreate)
  @SiteScope(fromBody('dossier', 'dossierId'))
  create(
    @Body() dto: CreateInstructionsDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindInstructionsQueryDto) {
    return this.instructionsService.findAll(query);
  }

  // The "Tâches" page in one call: the caller's own tasks (no permission
  // needed — they're theirs). Declared before ':id' so "taches" isn't
  // parsed as an id.
  @Get('taches')
  findMyTasks(
    @Query() query: FindMyTasksQueryDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.findMyTasks(query, user.sub);
  }

  // Instructions in progress per agent, with their capacity. Declared
  // before ':id'. Scoped in the service to the sites where the caller may
  // assign tasks.
  @Get('workload')
  workload(
    @Query() query: FindWorkloadQueryDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.workload(query, user.sub);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.instructionsService.findOne(id);
  }

  // Notifies its executants again — its superviseur, its creator or a
  // platform administrator; once an hour at most (409 otherwise).
  @Post(':id/remind')
  remind(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.remind(id, user.sub);
  }

  @Patch(':id')
  @RequirePermission(PermissionCode.InstructionUpdate)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInstructionDto,
  ) {
    return this.instructionsService.update(id, dto);
  }

  // By designation: the task's superviseur, or its creator when it has none.
  @Patch(':id/delai-execution')
  setAgentDueDate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAgentDueDateDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.setAgentDueDate(
      id,
      dto.agentDueDate,
      user.sub,
    );
  }

  @Post(':id/assign')
  @RequirePermission(PermissionCode.InstructionAssign)
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignInstructionDto,
  ) {
    return this.instructionsService.assign(id, dto);
  }

  // By designation, not by role: only one of the task's executants may
  // subscribe to it — checked in InstructionsService.
  @Patch(':id/souscrire')
  subscribe(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.subscribe(id, user.sub);
  }

  // By designation too: only one of the task's executants may decline it.
  @Patch(':id/ne-pas-souscrire')
  declineSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineSubscriptionDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.declineSubscription(id, dto, user.sub);
  }

  // Former names of the two routes above, kept until the frontend has moved
  // to "souscrire / ne pas souscrire". Remove them then.
  @Patch(':id/accept')
  @ApiOperation({
    deprecated: true,
    summary: 'Ancien nom de PATCH /instructions/:id/souscrire',
  })
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.subscribe(id, user);
  }

  @Patch(':id/refuse')
  @ApiOperation({
    deprecated: true,
    summary: 'Ancien nom de PATCH /instructions/:id/ne-pas-souscrire',
  })
  refuse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefuseInstructionDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.declineSubscription(id, { motif: dto.motif }, user);
  }

  // By designation: the task's superviseur, once its validateur gave their
  // opinion (validationStep 1; from 0 without a validateur). The validateur
  // never decides (403) — checked in InstructionsService.
  @Patch(':id/approve-livrables')
  @ApiOperation({
    summary:
      'Le superviseur valide les livrables soumis qui attendent sa décision',
    description:
      "Réservé au superviseur de l'instruction (ou à son créateur s'il n'y a pas de superviseur). Livrable.validationStep : 0 = avis du validateur attendu (PATCH /deliverables/{id}/avis, décision AVIS), 1 = décision du superviseur attendue. Sans validateur, le superviseur décide dès 0. Le validateur reçoit 403.",
  })
  approveLivrables(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.approveLivrables(id, user.sub);
  }

  @Patch(':id/approve-selected-livrables')
  @ApiOperation({
    summary: 'Le superviseur valide une sélection de livrables soumis',
    description:
      "Réservé au superviseur de l'instruction (ou à son créateur s'il n'y a pas de superviseur). Livrable.validationStep : 0 = avis du validateur attendu (PATCH /deliverables/{id}/avis, décision AVIS), 1 = décision du superviseur attendue. Sans validateur, le superviseur décide dès 0. Le validateur reçoit 403.",
  })
  approveSelectedLivrables(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveSelectedLivrablesDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.approveSelectedLivrables(
      id,
      dto.livrableIds,
      user.sub,
    );
  }

  @Patch(':id/request-corrections')
  @ApiOperation({
    summary:
      "Le superviseur demande des corrections : retour à l'agent, puis de nouveau au validateur",
    description:
      "Réservé au superviseur de l'instruction (ou à son créateur s'il n'y a pas de superviseur). Livrable.validationStep : 0 = avis du validateur attendu (PATCH /deliverables/{id}/avis, décision AVIS), 1 = décision du superviseur attendue. Sans validateur, le superviseur décide dès 0. Le validateur reçoit 403.",
  })
  requestCorrections(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestCorrectionsDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.requestCorrections(id, dto, user.sub);
  }

  @Get(':id/historique')
  historique(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.instructionsService.historique(
      id,
      skip ? parseInt(skip, 10) : 0,
      take ? parseInt(take, 10) : 20,
    );
  }

  @Patch(':id/close')
  @RequirePermission(PermissionCode.InstructionClose)
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseInstructionDto,
  ) {
    return this.instructionsService.close(id, dto.comment);
  }

  @Patch(':id/cancel')
  @RequirePermission(PermissionCode.InstructionCancel)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelInstructionDto,
  ) {
    return this.instructionsService.cancel(id, dto.reason);
  }

  // The executant who subscribed to the task only — checked in
  // InstructionsService.deposerLivrables.
  @Post(':id/livrables/deposer')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Déposer et soumettre un ou plusieurs livrables d’une instruction en un seul appel',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['livrables'],
      properties: {
        livrables: {
          type: 'string',
          description:
            'Chaîne JSON contenant la liste des livrables à déposer avec leurs fichiers : [{"livrableId": "uuid-1", "files": ["f0"]}]',
        },
        agentComment: {
          type: 'string',
          description: "Commentaire de l'agent pour le superviseur",
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Instruction mise à jour avec les livrables déposés et soumis',
  })
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: memoryStorage(),
      limits: { fileSize: ATTACHMENT_MAX_BYTES },
    }),
  )
  deposerLivrables(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeposerLivrablesDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.deposerLivrables(
      id,
      dto,
      files ?? [],
      user.sub,
    );
  }
}
