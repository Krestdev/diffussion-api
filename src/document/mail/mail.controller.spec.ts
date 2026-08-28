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
      submitForVerification: jest.fn(),
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

  it('submitForVerification() forwards the current user', () => {
    controller.submitForVerification('c-1', {
      sub: 'u-1',
      email: 'u@x.com',
      refreshToken: 'r',
    });
    expect(service.submitForVerification).toHaveBeenCalledWith('c-1', 'u-1');
  });
});
