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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { Permission } from '../../auth/permissions';
import {
  RequirePermissions,
  SameCompany,
  fromParam,
} from '../../auth/access/decorators';
import { AuthUser } from '../../auth/types/auth-user.type';
import { RejectLivrableDto } from '../../instructions/dto/request-corrections.dto';
import { InstructionsService } from '../../instructions/instructions.service';
import { DeliverableService } from './deliverable.service';
import { CreateDeliverableDto } from './dto/create-deliverable.dto';
import { AvisDeliverableDto } from './dto/avis-deliverable.dto';
import { DepositDeliverableDto } from './dto/deposit-deliverable.dto';
import { FindDeliverableQueryDto } from './dto/find-deliverable-query.dto';
import { UpdateDeliverableDto } from './dto/update-deliverable.dto';

@ApiTags('livrables')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
// The targeted livrable must belong to the person's company.
@SameCompany(fromParam('livrable'))
@Controller('deliverables')
export class DeliverableController {
  constructor(
    private readonly deliverableService: DeliverableService,
    private readonly instructionsService: InstructionsService,
  ) {}

  // Preparing a task's livrables (create, edit, new version, remove): the
  // executant who subscribed to it, or the holders of the permission at its
  // company. Depositing and submitting: the subscriber only. See
  // InstructionsService.assertMayWorkOn / assertSubscriber.
  @Post()
  async create(
    @Body() dto: CreateDeliverableDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.instructionsService.assertMayWorkOn(
      dto.instructionId,
      user.sub,
      [Permission.DELIVERABLE_CREATE],
    );
    return this.deliverableService.create(dto, user.sub);
  }

  @Get()
  @RequirePermissions(Permission.DELIVERABLE_READ)
  findAll(
    @Query() query: FindDeliverableQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.deliverableService.findAll(query, user.sub);
  }

  @Get(':id')
  @RequirePermissions(Permission.DELIVERABLE_READ)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliverableService.findOneWithHistory(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliverableDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertMayWorkOnLivrable(id, user.sub, [
      Permission.DELIVERABLE_CREATE,
    ]);
    return this.deliverableService.update(id, dto);
  }

  @Post(':id/new-version')
  async newVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliverableDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertMayWorkOnLivrable(id, user.sub, [
      Permission.DELIVERABLE_UPDATE,
    ]);
    return this.deliverableService.newVersion(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertMayWorkOnLivrable(id, user.sub, [
      Permission.DELIVERABLE_CREATE,
    ]);
    return this.deliverableService.remove(id);
  }

  @Post(':id/deposit')
  async deposit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DepositDeliverableDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertSubscriberOf(id, user.sub);
    return this.deliverableService.deposit(id, dto.agentComment);
  }

  @Post(':id/submit')
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assertSubscriberOf(id, user.sub);
    return this.deliverableService.submit(id);
  }

  // Depositing and submitting: the executant who subscribed to the task.
  private async assertSubscriberOf(livrableId: string, userId: string) {
    const { instructionId } = await this.deliverableService.findOne(livrableId);
    await this.instructionsService.assertSubscriber(instructionId, userId);
  }

  private async assertMayWorkOnLivrable(
    livrableId: string,
    userId: string,
    permissions: Permission[],
  ) {
    const { instructionId } = await this.deliverableService.findOne(livrableId);
    await this.instructionsService.assertMayWorkOn(
      instructionId,
      userId,
      permissions,
    );
  }

  // The validateur's opinion (AVIS) on a submitted livrable: it moves on
  // to the superviseur (validationStep 0 -> 1). The validateur's only
  // action — checked in InstructionsService.
  @Patch(':id/avis')
  @ApiOperation({
    summary:
      'Avis du validateur sur un livrable soumis (validationStep 0 -> 1)',
    description:
      "Réservé au validateur de l'instruction, sur un livrable SOUMIS à validationStep 0. Ajoute une décision AVIS avec son commentaire et passe le livrable au superviseur (validationStep 1), qui décide seul : conforme ou correction.",
  })
  giveAvis(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AvisDeliverableDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.instructionsService.giveAvis(id, dto.comment, user.sub);
  }

  // 10.4.4.6: the superviseur rejects one submitted livrable, with its
  // motif — once the validateur gave their opinion. Part of the
  // instruction's validation round, hence handled (and checked) by
  // InstructionsService.
  @Patch(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectLivrableDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.instructionsService.rejectLivrable(id, dto.motif, user.sub);
  }
}
