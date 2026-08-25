import { Test, TestingModule } from '@nestjs/testing';
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
      verify: jest.fn(),
      validateCourrier: jest.fn(),
      send: jest.fn(),
      cancel: jest.fn(),
      discharge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MailController],
      providers: [{ provide: MailService, useValue: service }],
    }).compile();

    controller = module.get<MailController>(MailController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('validate() forwards the current user as validator', () => {
    controller.validate('c-1', true, 'ok', {
      sub: 'u-1',
      email: 'u@x.com',
      refreshToken: 'r',
    });
    expect(service.validateCourrier).toHaveBeenCalledWith(
      'c-1',
      true,
      'u-1',
      'ok',
    );
  });
});
