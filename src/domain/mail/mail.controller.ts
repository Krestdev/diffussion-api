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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { JwtPayloadWithRefreshToken } from '../../auth/types/jwt-payload.type';
import { SetAccessDto } from '../../common/dto/access.dto';
import { SetOwnerDto } from '../../common/dto/set-owner.dto';
import { CreateMailDto } from './dto/create-mail.dto';
import { FindMailsQueryDto } from './dto/find-mails.query.dto';
import { UpdateMailDto } from './dto/update-mail.dto';
import { MailService } from './mail.service';

@ApiTags('courriers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('courriers')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post()
  @RequirePermission(PermissionCode.CourrierRegisterEntrant)
  create(
    @Body() dto: CreateMailDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindMailsQueryDto) {
    return this.mailService.findAll(query);
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
