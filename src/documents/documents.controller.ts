import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayloadWithRefreshToken } from '../auth/types/jwt-payload.type';
import { SetAccessDto } from '../common/dto/access.dto';
import { SetOwnerDto } from '../common/dto/set-owner.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { FindDocumentsQueryDto } from './dto/find-documents.query.dto';
import { DocumentsService } from './documents.service';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string', maxLength: 200, description: 'Human-readable display name (defaults to filename if omitted)' },
        dossierId: { type: 'string', format: 'uuid' },
        courrierId: { type: 'string', format: 'uuid' },
        livrableId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.documentsService.upload(file, dto, user.sub);
  }

  @Get()
  findAll(
    @Query() query: FindDocumentsQueryDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.documentsService.findAll(query, user.sub);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.documentsService.findOne(id, user.sub);
  }

  @Get(':id/download-url')
  getDownloadUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.documentsService.getDownloadUrl(id, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.documentsService.remove(id, user.sub);
  }

  // Authorization (uploader / site responsible / platform admin) is
  // enforced inside DocumentsService.setOwner.
  @Patch(':id/owner')
  setOwner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOwnerDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.documentsService.setOwner(id, dto, user.sub);
  }

  @Get(':id/access')
  getAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.documentsService.getAccess(id, user.sub);
  }

  @Put(':id/access')
  setAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAccessDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.documentsService.setAccess(id, dto, user.sub);
  }
}
