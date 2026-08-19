import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { KeyQueryDto } from './dto/key.query.dto';
import { SignedUrlQueryDto } from './dto/signed-url.query.dto';
import { UploadQueryDto } from './dto/upload.query.dto';
import { StorageService } from './storage.service';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@ApiTags('storage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query() query: UploadQueryDto,
  ) {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    return this.storageService.upload(file.buffer, {
      originalName: file.originalname,
      contentType: file.mimetype,
      prefix: query.prefix,
    });
  }

  @Get('download')
  async download(
    @Query() query: KeyQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, contentType, contentLength } =
      await this.storageService.download(query.key);

    res.set({
      'Content-Type': contentType ?? 'application/octet-stream',
      ...(contentLength ? { 'Content-Length': String(contentLength) } : {}),
    });
    return new StreamableFile(body);
  }

  @Get('signed-url')
  getSignedUrl(@Query() query: SignedUrlQueryDto) {
    return this.storageService
      .getSignedDownloadUrl(query.key, query.expiresIn)
      .then((url) => ({ url, expiresIn: query.expiresIn ?? 900 }));
  }

  @Delete()
  async remove(@Query() query: KeyQueryDto): Promise<void> {
    await this.storageService.delete(query.key);
  }
}
