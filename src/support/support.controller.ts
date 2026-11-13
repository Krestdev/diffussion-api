import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { PaginationQueryDto } from '../common/dto/pagination.query.dto';
import { attachmentUploadOptions } from '../common/utils/attachment-upload';
import {
  CreateSupportMessageDto,
  CreateSupportTicketDto,
  HelpFeedbackDto,
} from './dto/support.dto';
import { SupportService } from './support.service';

const MAX_ATTACHMENTS = 5;

@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('support/tickets')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor(
      'attachments',
      MAX_ATTACHMENTS,
      attachmentUploadOptions(MAX_ATTACHMENTS),
    ),
  )
  create(
    @Body() dto: CreateSupportTicketDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.support.createTicket(dto, files ?? [], user.sub);
  }

  @Get('support/tickets')
  findMine(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.support.findMine(query, user.sub);
  }

  @Get('support/tickets/:id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.support.findOne(id, user.sub);
  }

  @Post('support/tickets/:id/messages')
  addMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSupportMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.support.addMessage(id, dto, user.sub);
  }

  @Get('support/tickets/:id/attachments/:attachmentId')
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const file = await this.support.attachmentFile(id, attachmentId, user.sub);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    file.body.pipe(res);
  }

  @Post('help/feedback')
  feedback(@Body() dto: HelpFeedbackDto, @CurrentUser() user: JwtPayload) {
    return this.support.feedback(dto, user.sub);
  }
}
