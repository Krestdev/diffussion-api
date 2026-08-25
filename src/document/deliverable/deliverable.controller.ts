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
import { JwtPayloadWithRefreshToken } from '../../auth/types/jwt-payload.type';
import { DeliverableService } from './deliverable.service';
import { CreateDeliverableDto } from './dto/create-deliverable.dto';
import { FindDeliverableQueryDto } from './dto/find-deliverable-query.dto';
import { UpdateDeliverableDto } from './dto/update-deliverable.dto';

@ApiTags('livrables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('deliverables')
export class DeliverableController {
  constructor(private readonly deliverableService: DeliverableService) {}

  @Post()
  @RequirePermission(PermissionCode.LivrableDeposit)
  create(
    @Body() dto: CreateDeliverableDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.deliverableService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindDeliverableQueryDto) {
    return this.deliverableService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliverableService.findOne(id);
  }

  @Patch(':id')
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
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliverableService.remove(id);
  }

  @Post(':id/deposit')
  deposit(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliverableService.deposit(id);
  }

  @Post(':id/submit')
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliverableService.submit(id);
  }
}
