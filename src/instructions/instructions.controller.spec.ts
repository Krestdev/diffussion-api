import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import { InstructionsController } from './instructions.controller';
import { InstructionsService } from './instructions.service';

describe('InstructionsController', () => {
  let controller: InstructionsController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      assign: jest.fn(),
      declineSubscription: jest.fn(),
      subscribe: jest.fn(),
      close: jest.fn(),
      cancel: jest.fn(),
      deposerLivrables: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InstructionsController],
      providers: [{ provide: InstructionsService, useValue: service }],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<InstructionsController>(InstructionsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  const user = { sub: 'u-1', email: 'u@x.com', refreshToken: 'r' };

  it('declineSubscription() forwards the motif and the current user', () => {
    controller.declineSubscription('i-1', { motif: 'Non disponible' }, user);
    expect(service.declineSubscription).toHaveBeenCalledWith(
      'i-1',
      { motif: 'Non disponible' },
      'u-1',
    );
  });

  it('keeps the former routes working until the frontend moves over', () => {
    controller.accept('i-1', user);
    // The former body's newAssigneeId is accepted and ignored.
    controller.refuse(
      'i-1',
      { motif: 'Non disponible', newAssigneeId: 'u-2' },
      user,
    );
    expect(service.subscribe).toHaveBeenCalledWith('i-1', 'u-1');
    expect(service.declineSubscription).toHaveBeenCalledWith(
      'i-1',
      { motif: 'Non disponible' },
      'u-1',
    );
  });

  it('deposerLivrables() forwards id, dto, files and user id', () => {
    const dto = { livrables: '[]', agentComment: 'OK' };
    const files = [] as Express.Multer.File[];
    controller.deposerLivrables('i-1', dto, files, user);
    expect(service.deposerLivrables).toHaveBeenCalledWith(
      'i-1',
      dto,
      files,
      'u-1',
    );
  });
});
