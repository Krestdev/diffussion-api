import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      upload: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      getDownloadUrl: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [{ provide: DocumentsService, useValue: service }],
    }).compile();

    controller = module.get<DocumentsController>(DocumentsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('upload() rejects when no file is attached', () => {
    expect(() =>
      controller.upload(
        undefined,
        {},
        {
          sub: 'u-1',
          email: 'u@x.com',
          refreshToken: 'r',
        },
      ),
    ).toThrow(BadRequestException);
  });
});
