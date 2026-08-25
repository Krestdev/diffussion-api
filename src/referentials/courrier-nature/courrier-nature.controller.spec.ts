import { Test, TestingModule } from '@nestjs/testing';
import { CourrierNatureController } from './courrier-nature.controller';
import { CourrierNatureService } from './courrier-nature.service';

describe('CourrierNatureController', () => {
  let controller: CourrierNatureController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourrierNatureController],
      providers: [CourrierNatureService],
    }).compile();

    controller = module.get<CourrierNatureController>(CourrierNatureController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
