import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DatabaseService } from '../database/database.service';
import { StorageService } from '../storage/storage.service';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let database: { document: Record<string, jest.Mock> };
  let storage: Record<string, jest.Mock>;

  beforeEach(async () => {
    database = {
      document: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    storage = {
      upload: jest.fn(),
      delete: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: DatabaseService, useValue: database },
        { provide: StorageService, useValue: storage },
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
});
