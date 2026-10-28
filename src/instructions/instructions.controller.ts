import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InstructionsService } from './instructions.service';
import { LivrableHistoryInterceptor } from './livrable-history.interceptor';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { CreateInstructionsDto } from './dto/create-instruction.dto';
import { FindInstructionsQueryDto } from './dto/find-instructions.query.dto';
import { FindMyTasksQueryDto } from './dto/find-my-tasks.query.dto';
import { DeclineSubscriptionDto } from './dto/decline-subscription.dto';
import { RefuseInstructionDto } from './dto/refuse-instruction.dto';
import { SetAgentDueDateDto } from './dto/set-agent-due-date.dto';
import { UpdateInstructionDto } from './dto/update-instruction.dto';
import { ApproveSelectedLivrablesDto } from './dto/approve-selected-livrables.dto';
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

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.instructionsService.findOne(id);
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

  @Patch(':id/approve-livrables')
  @RequirePermission(PermissionCode.ValidationApprove)
  approveLivrables(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.approveLivrables(id, user.sub);
  }

  @Patch(':id/approve-selected-livrables')
  @RequirePermission(PermissionCode.ValidationApprove)
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
  @RequirePermission(PermissionCode.ValidationRequestCorrections)
  requestCorrections(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestCorrectionsDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.requestCorrections(id, dto, user.sub);
  }

  @Patch(':id/close')
  @RequirePermission(PermissionCode.InstructionClose)
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.instructionsService.close(id);
  }

  @Patch(':id/cancel')
  @RequirePermission(PermissionCode.InstructionCancel)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.instructionsService.cancel(id);
  }
}
