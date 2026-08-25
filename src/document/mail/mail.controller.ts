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

  @Post(':id/submit-for-verification')
  @RequirePermission(PermissionCode.CourrierWriteSortant)
  submitForVerification(@Param('id', ParseUUIDPipe) id: string) {
    return this.mailService.submitForVerification(id);
  }

  @Post(':id/verify')
  @RequirePermission(PermissionCode.ValidationVerify)
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('approved') approved: boolean,
  ) {
    return this.mailService.verify(id, approved);
  }

  @Post(':id/validate')
  @RequirePermission(PermissionCode.ValidationApprove)
  validate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('approved') approved: boolean,
    @Body('motif') motif: string | undefined,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.validateCourrier(id, approved, user.sub, motif);
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

  @Post(':id/discharge')
  discharge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.mailService.discharge(id, user.sub);
  }
}
