import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { SetAccessDto } from '../common/dto/access.dto';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { FindDocumentsQueryDto } from './dto/find-documents.query.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';

const documentAccessInclude = {
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.DocumentAccessInclude;

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

  // Independent from its dossier's/courrier's own access list (see
  // DocumentAccess in schema.prisma) — a user with access to either does
  // not automatically get access to this specific document, and vice versa.
  async getAccess(id: string) {
    await this.findOne(id);
    return this.database.documentAccess.findMany({
      where: { documentId: id },
      include: documentAccessInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async setAccess(id: string, dto: SetAccessDto) {
    await this.findOne(id);
    const userIds = dto.entries.map((entry) => entry.userId);

    await this.database.$transaction([
      this.database.documentAccess.deleteMany({
        where: {
          documentId: id,
          userId: { notIn: userIds.length > 0 ? userIds : ['__none__'] },
        },
      }),
      ...dto.entries.map((entry) =>
        this.database.documentAccess.upsert({
          where: {
            documentId_userId: { documentId: id, userId: entry.userId },
          },
          create: {
            documentId: id,
            userId: entry.userId,
            canView: entry.canView,
            canEdit: entry.canEdit,
          },
          update: { canView: entry.canView, canEdit: entry.canEdit },
        }),
      ),
    ]);

    return this.getAccess(id);
  }
}
