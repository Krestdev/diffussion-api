import { Test, TestingModule } from '@nestjs/testing';
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
      accept: jest.fn(),
      refuse: jest.fn(),
      close: jest.fn(),
      cancel: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InstructionsController],
      providers: [{ provide: InstructionsService, useValue: service }],
    }).compile();

    controller = module.get<InstructionsController>(InstructionsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('refuse() forwards id and dto to the service', () => {
    controller.refuse('i-1', { motif: 'Non disponible' });
    expect(service.refuse).toHaveBeenCalledWith('i-1', {
      motif: 'Non disponible',
    });
  });
});
