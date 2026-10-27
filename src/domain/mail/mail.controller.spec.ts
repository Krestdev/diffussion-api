import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';

describe('MailController', () => {
  let controller: MailController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      transmit: jest.fn(),
      submitForValidation: jest.fn(),
      send: jest.fn(),
      cancel: jest.fn(),
      discharge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MailController],
      providers: [{ provide: MailService, useValue: service }],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MailController>(MailController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('submitForValidation() forwards the current user', () => {
    controller.submitForValidation('c-1', {
      sub: 'u-1',
      email: 'u@x.com',
      refreshToken: 'r',
    });
    expect(service.submitForValidation).toHaveBeenCalledWith('c-1', 'u-1');
  });

  it('create() forwards dto, user and files to service.create', () => {
    const dto = {
      dossierId: 'd-1',
      direction: 'ENTRANT' as any,
      subject: 'Subject',
    };
    const files = [{ originalname: 'file.pdf', buffer: Buffer.from('') }] as any;
    controller.create(dto, { sub: 'u-1', email: 'u@x.com', refreshToken: 'r' }, files);
    expect(service.create).toHaveBeenCalledWith(dto, 'u-1', files);
  });

  it('validates CreateMailDto with JSON string documents without whitelist errors', async () => {
    const { ValidationPipe } = await import('@nestjs/common');
    const { CreateMailDto } = await import('./dto/create-mail.dto');
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const payload = {
      dossierId: '29a450e4-e683-4868-8fe3-bbe21c7b5f25',
      direction: 'ENTRANT',
      subject: 'Le courier avec document',
      documents: '[{"name":"DSF"}]',
    };
    const transformed = await pipe.transform(payload, {
      type: 'body',
      metatype: CreateMailDto,
    });
    expect(transformed.documents).toHaveLength(1);
    expect(transformed.documents[0].name).toBe('DSF');
  });
});
