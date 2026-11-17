import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContractStatus, Prisma } from '../generated/prisma/client';
import { SetAccessDto } from '../common/dto/access.dto';
import { SetOwnerDto } from '../common/dto/set-owner.dto';
import { assertDossierOpenForActivity } from '../common/utils/dossier-lifecycle';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { AccessService } from '../auth/access/access.service';
import { Permission } from '../auth/permissions';
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
    private readonly access: AccessService,
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
    const owners = [
      dto.dossierId,
      dto.courrierId,
      dto.livrableId,
      dto.contractId,
    ].filter(Boolean);
    if (owners.length !== 1) {
      throw new BadRequestException(
        'Provide exactly one of dossierId, courrierId, livrableId, contractId',
      );
    }
    if (dto.contractId) {
      await this.assertContractOpen(dto.contractId);
    }
    await this.assertOnCallersCompany(dto, uploadedById);

    // Null only for a sortant draft not yet attached to its dossier: its
    // letter can be uploaded before the dossier is chosen.
    const dossierId = await this.resolveDossierId(dto);
    if (dossierId) {
      await assertDossierOpenForActivity(this.database, dossierId);
    }

    const prefix = dto.dossierId
      ? `dossiers/${dto.dossierId}`
      : dto.courrierId
        ? `courriers/${dto.courrierId}`
        : dto.contractId
          ? `contracts/${dto.contractId}`
          : `livrables/${dto.livrableId}`;

    const { key } = await this.storage.upload(file.buffer, {
      originalName: file.originalname,
      contentType: file.mimetype,
      prefix,
    });

    return this.database.document.create({
      data: {
        originalName: file.originalname,
        name: dto.name ?? file.originalname,
        storageKey: key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        dossierId: dto.dossierId,
        courrierId: dto.courrierId,
        livrableId: dto.livrableId,
        contractId: dto.contractId,
        ownerId: dto.ownerId,
        uploadedById,
      },
    });
  }

  /**
   * Same rule as assertCanAccessDocument, expressed as a filter: a list must
   * not leak the existence (name, and above all storage key) of documents the
   * caller could not open anyway.
   */
  async findAll(query: FindDocumentsQueryDto, actingUserId: string) {
    // An administrator (role.assign) sees every document of their company.
    const [adminOf] = await this.access.scope(
      actingUserId,
      Permission.ROLE_ASSIGN,
    );
    const where: Prisma.DocumentWhereInput = {
      dossierId: query.dossierId,
      courrierId: query.courrierId,
      livrableId: query.livrableId,
      contractId: query.contractId,
      ...(adminOf
        ? documentOfCompany(adminOf)
        : {
            OR: [
              { uploadedById: actingUserId },
              { ownerId: actingUserId },
              { accesses: { some: { userId: actingUserId } } },
              { dossier: { company: { responsibleId: actingUserId } } },
              {
                courrier: {
                  dossier: { company: { responsibleId: actingUserId } },
                },
              },
              { contract: { responsibleId: actingUserId } },
            ],
          }),
    };
    return this.database.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // storageKey stays out of listings: downloads go through
      // /documents/:id/download-url, which checks access first.
      select: {
        id: true,
        originalName: true,
        name: true,
        mimeType: true,
        sizeBytes: true,
        dossierId: true,
        courrierId: true,
        livrableId: true,
        contractId: true,
        ownerId: true,
        uploadedById: true,
        createdAt: true,
      },
    });
  }

  async findOne(id: string, actingUserId: string) {
    const document = await this.database.document.findUnique({
      where: { id },
      include: {
        dossier: { select: { company: true } },
        courrier: { select: { dossier: { select: { company: true } } } },
        contract: { select: { responsibleId: true } },
        accesses: { where: { userId: actingUserId } },
      },
    });
    if (!document) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    await this.assertCanAccessDocument(document, actingUserId);

    return document;
  }

  async getDownloadUrl(id: string, actingUserId: string) {
    const document = await this.findOne(id, actingUserId);
    const url = await this.storage.getSignedDownloadUrl(document.storageKey);
    return { url, expiresIn: 900 };
  }

  async remove(id: string, actingUserId: string) {
    const document = await this.findOne(id, actingUserId);
    await this.storage.delete(document.storageKey);
    await this.database.document.delete({ where: { id } });
  }

  // Nothing is added to another company's dossier, effet, livrable or contract.
  private async assertOnCallersCompany(dto: UploadDocumentDto, userId: string) {
    const companyId = dto.contractId
      ? (
          await this.database.contract.findUnique({
            where: { id: dto.contractId },
            select: { project: { select: { companyId: true } } },
          })
        )?.project?.companyId
      : dto.dossierId
        ? await this.access.resolveCompanyId('dossier', dto.dossierId)
        : dto.courrierId
          ? await this.access.resolveCompanyId('courrier', dto.courrierId)
          : await this.access.resolveCompanyId('livrable', dto.livrableId!);
    if (companyId && !(await this.access.worksAtCompany(userId, companyId))) {
      throw new ForbiddenException('Ce document relève d’un autre société');
    }
  }

  // RG-DOC-003: Document read access is independent from the dossier.
  // Access is granted to the uploader, the person in charge, explicitly
  // listed users in DocumentAccess, the responsible of the company, or a
  // company administrator (role.assign, the document being of their company).
  private async assertCanAccessDocument(
    document: {
      id: string;
      uploadedById: string | null;
      ownerId: string | null;
      dossier: { company: { responsibleId: string | null } | null } | null;
      courrier: {
        dossier: { company: { responsibleId: string | null } | null } | null;
      } | null;
      contract: { responsibleId: string | null } | null;
      accesses: { userId: string }[];
    },
    actingUserId: string,
  ) {
    if (document.uploadedById === actingUserId) return;
    if (document.ownerId === actingUserId) return;
    if (document.accesses.length > 0) return;

    const company =
      document.dossier?.company ?? document.courrier?.dossier?.company;
    if (company?.responsibleId === actingUserId) return;
    if (document.contract?.responsibleId === actingUserId) return;

    if (await this.isAdminOfDocument(actingUserId, document.id)) return;

    throw new ForbiddenException(
      'You do not have permission to access this document',
    );
  }

  // An administrator (role.assign) of the company the document belongs to.
  private async isAdminOfDocument(userId: string, documentId: string) {
    const [companyId] = await this.access.scope(userId, Permission.ROLE_ASSIGN);
    if (!companyId) return false;
    const found = await this.database.document.count({
      where: { id: documentId, ...documentOfCompany(companyId) },
    });
    return found > 0;
  }

  private async assertContractOpen(contractId: string) {
    const contract = await this.database.contract.findUnique({
      where: { id: contractId },
      select: { number: true, status: true },
    });
    if (!contract) {
      throw new NotFoundException(`Contract ${contractId} not found`);
    }
    if (contract.status === ContractStatus.ARCHIVED) {
      throw new BadRequestException(
        `Contract ${contract.number} is archived — no document can be added to it`,
      );
    }
  }

  // The dossier a new document ultimately lands in: directly, through its
  // courrier, or through its livrable's instruction. A contract's own
  // document is in no dossier.
  private async resolveDossierId(
    dto: UploadDocumentDto,
  ): Promise<string | null> {
    if (dto.contractId) return null;
    if (dto.dossierId) return dto.dossierId;
    if (dto.courrierId) {
      const courrier = await this.database.courrier.findUnique({
        where: { id: dto.courrierId },
        select: { dossierId: true },
      });
      if (!courrier) {
        throw new NotFoundException(`Courrier ${dto.courrierId} not found`);
      }
      return courrier.dossierId;
    }
    const livrable = await this.database.livrable.findUnique({
      where: { id: dto.livrableId },
      select: { instruction: { select: { dossierId: true } } },
    });
    if (!livrable) {
      throw new NotFoundException(`Livrable ${dto.livrableId} not found`);
    }
    return livrable.instruction.dossierId;
  }

  // Person in charge — same semantics/authorization as
  // MailService.setOwner: the uploader, the responsible of the owning
  // company (resolved through the document's dossier, or failing that its
  // courrier's dossier), or an administrator (role.assign) of its company.
  async setOwner(id: string, dto: SetOwnerDto, actingUserId: string) {
    const document = await this.database.document.findUnique({
      where: { id },
      include: {
        dossier: { select: { company: true } },
        courrier: { select: { dossier: { select: { company: true } } } },
      },
    });
    if (!document) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    const company =
      document.dossier?.company ?? document.courrier?.dossier?.company;
    const isUploader = document.uploadedById === actingUserId;
    const isCompanyAdmin = company?.responsibleId === actingUserId;
    const isPlatformAdmin = await this.isAdminOfDocument(actingUserId, id);
    if (!isUploader && !isCompanyAdmin && !isPlatformAdmin) {
      throw new ForbiddenException(
        'Only the uploader, the company responsible, or an administrator of its company can assign who is in charge of this document',
      );
    }
    return this.database.document.update({
      where: { id },
      data: { ownerId: dto.ownerId },
    });
  }

  // Independent from its dossier's/courrier's own access list (see
  // DocumentAccess in schema.prisma) — a user with access to either does
  // not automatically get access to this specific document, and vice versa.
  async getAccess(id: string, actingUserId: string) {
    await this.findOne(id, actingUserId);
    return this.database.documentAccess.findMany({
      // Not the people deleted in the core (C9).
      where: { documentId: id, user: { deletedAt: null } },
      include: documentAccessInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async setAccess(id: string, dto: SetAccessDto, actingUserId: string) {
    await this.findOne(id, actingUserId);
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

    return this.getAccess(id, actingUserId);
  }
}

// The documents of a company: through their dossier, effet (its dossier's company,
// else its registrant's), livrable (its task's dossier), contract (its project), or —
// attached to none of them — their uploader's company.
function documentOfCompany(companyId: string): Prisma.DocumentWhereInput {
  return {
    OR: [
      { dossier: { companyId } },
      {
        courrier: {
          OR: [
            { dossier: { companyId } },
            { dossierId: null, createdBy: { companyId } },
          ],
        },
      },
      { livrable: { instruction: { dossier: { companyId } } } },
      { contract: { project: { companyId } } },
      {
        dossierId: null,
        courrierId: null,
        livrableId: null,
        contractId: null,
        uploadedBy: { companyId },
      },
    ],
  };
}
