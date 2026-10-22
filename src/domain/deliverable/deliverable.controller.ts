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
import { RejectLivrableDto } from '../../instructions/dto/request-corrections.dto';
import { InstructionsService } from '../../instructions/instructions.service';
import { DeliverableService } from './deliverable.service';
import { CreateDeliverableDto } from './dto/create-deliverable.dto';
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

  @Post()
  @RequirePermission(PermissionCode.LivrableDeposit)
  @SiteScope(fromBody('instruction', 'instructionId'))
  create(
    @Body() dto: CreateDeliverableDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
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
  @RequirePermission(PermissionCode.LivrableDeposit)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliverableDto,
  ) {
    return this.deliverableService.update(id, dto);
  }

  @Post(':id/new-version')
  @RequirePermission(PermissionCode.LivrableNewVersion)
  newVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliverableDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.deliverableService.newVersion(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionCode.LivrableDeposit)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliverableService.remove(id);
  }

  @Post(':id/deposit')
  @RequirePermission(PermissionCode.LivrableDeposit)
  deposit(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliverableService.deposit(id);
  }

  @Post(':id/submit')
  @RequirePermission(PermissionCode.LivrableSubmit)
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliverableService.submit(id);
  }

  // 10.4.4.6: the supervisor rejects one submitted livrable, with its
  // motif. Part of the instruction's validation round, hence handled by
  // InstructionsService.
  @Patch(':id/reject')
  @RequirePermission(PermissionCode.ValidationReject)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectLivrableDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.rejectLivrable(id, dto.motif, user.sub);
  }
}
