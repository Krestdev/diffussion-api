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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { SiteScope, fromParam } from '../../auth/rbac/site-scope.decorator';
import { JwtPayloadWithRefreshToken } from '../../auth/types/jwt-payload.type';
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
@UseGuards(JwtAuthGuard, PermissionGuard)
// Permissions are checked at the site of the targeted resource.
@SiteScope(fromParam('livrable'))
@Controller('deliverables')
export class DeliverableController {
  constructor(
    private readonly deliverableService: DeliverableService,
    private readonly instructionsService: InstructionsService,
  ) {}

  // Preparing a task's livrables (create, edit, new version, remove): the
  // executant who subscribed to it, or the holders of the permission at its
  // site. Depositing and submitting: the subscriber only. See
  // InstructionsService.assertMayWorkOn / assertSubscriber.
  @Post()
  async create(
    @Body() dto: CreateDeliverableDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    await this.instructionsService.assertMayWorkOn(
      dto.instructionId,
      user.sub,
      [PermissionCode.LivrableDeposit],
    );
    return this.deliverableService.create(dto, user.sub);
  }

  @Get()
  @RequirePermission(PermissionCode.LivrableRead)
  findAll(
    @Query() query: FindDeliverableQueryDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.deliverableService.findAll(query, user.sub);
  }

  @Get(':id')
  @RequirePermission(PermissionCode.LivrableRead)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliverableService.findOneWithHistory(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliverableDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    await this.assertMayWorkOnLivrable(id, user.sub, [
      PermissionCode.LivrableDeposit,
    ]);
    return this.deliverableService.update(id, dto);
  }

  @Post(':id/new-version')
  async newVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliverableDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    await this.assertMayWorkOnLivrable(id, user.sub, [
      PermissionCode.LivrableNewVersion,
    ]);
    return this.deliverableService.newVersion(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    await this.assertMayWorkOnLivrable(id, user.sub, [
      PermissionCode.LivrableDeposit,
    ]);
    return this.deliverableService.remove(id);
  }

  @Post(':id/deposit')
  async deposit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DepositDeliverableDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    await this.assertSubscriberOf(id, user.sub);
    return this.deliverableService.deposit(id, dto.agentComment);
  }

  @Post(':id/submit')
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
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
    permissions: PermissionCode[],
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
    @CurrentUser() user: JwtPayloadWithRefreshToken,
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
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.rejectLivrable(id, dto.motif, user.sub);
  }
}
