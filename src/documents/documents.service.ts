import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { FindDocumentsQueryDto } from './dto/find-documents.query.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    dto: UploadDocumentDto,
    uploadedById: string,
  ) {
    const owners = [dto.dossierId, dto.courrierId, dto.livrableId].filter(
      Boolean,
    );
    if (owners.length !== 1) {
      throw new BadRequestException(
        'Provide exactly one of dossierId, courrierId, livrableId',
      );
    }

    const prefix = dto.dossierId
      ? `dossiers/${dto.dossierId}`
      : dto.courrierId
        ? `courriers/${dto.courrierId}`
        : `livrables/${dto.livrableId}`;

    const { key } = await this.storage.upload(file.buffer, {
      originalName: file.originalname,
      contentType: file.mimetype,
      prefix,
    });

    return this.database.document.create({
      data: {
        originalName: file.originalname,
        storageKey: key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        dossierId: dto.dossierId,
        courrierId: dto.courrierId,
        livrableId: dto.livrableId,
        uploadedById,
      },
    });
  }

  findAll(query: FindDocumentsQueryDto) {
    const where: Prisma.DocumentWhereInput = {
      dossierId: query.dossierId,
      courrierId: query.courrierId,
      livrableId: query.livrableId,
    };
    return this.database.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const document = await this.database.document.findUnique({
      where: { id },
    });
    if (!document) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return document;
  }

  async getDownloadUrl(id: string) {
    const document = await this.findOne(id);
    const url = await this.storage.getSignedDownloadUrl(document.storageKey);
    return { url, expiresIn: 900 };
  }

  async remove(id: string) {
    const document = await this.findOne(id);
    await this.storage.delete(document.storageKey);
    await this.database.document.delete({ where: { id } });
  }
}
