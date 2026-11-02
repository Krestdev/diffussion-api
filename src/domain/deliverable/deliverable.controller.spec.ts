import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { InstructionsService } from '../../instructions/instructions.service';
import { DeliverableController } from './deliverable.controller';
import { DeliverableService } from './deliverable.service';

describe('DeliverableController', () => {
  let controller: DeliverableController;
  let service: Record<string, jest.Mock>;
  let instructions: Record<string, jest.Mock>;

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

    instructions = {
      rejectLivrable: jest.fn(),
      assertMayWorkOn: jest.fn().mockResolvedValue(undefined),
      assertSubscriber: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeliverableController],
      providers: [
        { provide: DeliverableService, useValue: service },
        // Rejecting a livrable is part of its instruction's validation round.
        { provide: InstructionsService, useValue: instructions },
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DeliverableController>(DeliverableController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('create() checks the user may work on the task, then forwards them', async () => {
    await controller.create(
      { instructionId: 'i-1', title: 'X' },
      {
        sub: 'u-1',
        email: 'u@x.com',
        refreshToken: 'r',
      },
    );
    expect(instructions.assertMayWorkOn).toHaveBeenCalledWith('i-1', 'u-1', [
      'LIVRABLE_DEPOSIT',
    ]);
    expect(service.create).toHaveBeenCalledWith(
      { instructionId: 'i-1', title: 'X' },
      'u-1',
    );
  });

  it('submit() is refused to anyone but the subscriber', async () => {
    service.findOne.mockResolvedValue({ instructionId: 'i-1' });
    instructions.assertSubscriber.mockRejectedValue(new Error('forbidden'));

    await expect(
      controller.submit('l-1', {
        sub: 'u-1',
        email: 'u@x.com',
        refreshToken: 'r',
      }),
    ).rejects.toThrow('forbidden');
    expect(service.submit).not.toHaveBeenCalled();
  });
});
