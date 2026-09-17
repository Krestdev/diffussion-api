import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { DeliverableController } from './deliverable.controller';
import { DeliverableService } from './deliverable.service';

describe('DeliverableController', () => {
  let controller: DeliverableController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      newVersion: jest.fn(),
      remove: jest.fn(),
      deposit: jest.fn(),
      submit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeliverableController],
      providers: [{ provide: DeliverableService, useValue: service }],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DeliverableController>(DeliverableController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('create() forwards the authenticated user', () => {
    controller.create(
      { instructionId: 'i-1', title: 'X' },
      {
        sub: 'u-1',
        email: 'u@x.com',
        refreshToken: 'r',
      },
    );
    expect(service.create).toHaveBeenCalledWith(
      { instructionId: 'i-1', title: 'X' },
      'u-1',
    );
  });
});
