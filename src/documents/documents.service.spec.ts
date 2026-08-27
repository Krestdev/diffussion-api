import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';
import { RbacService } from '../auth/rbac/rbac.service';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let database: {
    document: Record<string, jest.Mock>;
  };
  let storage: Record<string, jest.Mock>;
  let rbac: Record<string, jest.Mock>;

  beforeEach(async () => {
    database = {
      document: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    storage = {
      upload: jest.fn(),
      delete: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
    };
    rbac = { hasPermission: jest.fn().mockResolvedValue(false) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: DatabaseService, useValue: database },
        { provide: StorageService, useValue: storage },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  it('is defined', () => {
    expect(service).toBeDefined();
  });

  describe('upload', () => {
    it('refuses a file with no owner', async () => {
      await expect(
        service.upload(
          {
            buffer: Buffer.from(''),
            originalname: 'a.pdf',
            mimetype: 'application/pdf',
            size: 1,
          },
          {},
          'u-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a file with more than one owner', async () => {
      await expect(
        service.upload(
          {
            buffer: Buffer.from(''),
            originalname: 'a.pdf',
            mimetype: 'application/pdf',
            size: 1,
          },
          { dossierId: 'd-1', courrierId: 'c-1' },
          'u-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uploads to storage then records the document', async () => {
      storage.upload.mockResolvedValue({ key: 'dossiers/d-1/abc.pdf' });
      database.document.create.mockResolvedValue({ id: 'doc-1' });

      await service.upload(
        {
          buffer: Buffer.from('x'),
          originalname: 'a.pdf',
          mimetype: 'application/pdf',
          size: 1,
        },
        { dossierId: 'd-1' },
        'u-1',
      );

      expect(storage.upload).toHaveBeenCalled();
      expect(database.document.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            storageKey: 'dossiers/d-1/abc.pdf',
            dossierId: 'd-1',
            uploadedById: 'u-1',
          }),
        }),
      );
    });
  });

  describe('setOwner', () => {
    it('allows the uploader', async () => {
      database.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        uploadedById: 'u-1',
        dossier: null,
        courrier: null,
      });
      database.document.update.mockResolvedValue({ id: 'doc-1' });

      await expect(
        service.setOwner('doc-1', { ownerId: 'u-2' }, 'u-1'),
      ).resolves.toBeDefined();
    });

    it("allows the owning site's responsible, resolved through the document's courrier", async () => {
      database.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        uploadedById: 'someone-else',
        dossier: null,
        courrier: { dossier: { site: { responsibleId: 'u-1' } } },
      });
      database.document.update.mockResolvedValue({ id: 'doc-1' });

      await expect(
        service.setOwner('doc-1', { ownerId: 'u-2' }, 'u-1'),
      ).resolves.toBeDefined();
    });

    it('allows a platform admin', async () => {
      database.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        uploadedById: 'someone-else',
        dossier: { site: { responsibleId: 'someone-else-too' } },
        courrier: null,
      });
      rbac.hasPermission.mockResolvedValue(true);
      database.document.update.mockResolvedValue({ id: 'doc-1' });

      await expect(
        service.setOwner('doc-1', { ownerId: 'u-2' }, 'u-1'),
      ).resolves.toBeDefined();
    });

    it('refuses anyone else', async () => {
      database.document.findUnique.mockResolvedValue({
        id: 'doc-1',
        uploadedById: 'someone-else',
        dossier: { site: { responsibleId: 'someone-else-too' } },
        courrier: null,
      });

      await expect(
        service.setOwner('doc-1', { ownerId: 'u-2' }, 'u-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.document.update).not.toHaveBeenCalled();
    });
  });
});
