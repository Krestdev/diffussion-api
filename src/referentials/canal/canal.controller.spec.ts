import { Test, TestingModule } from '@nestjs/testing';
import { CanalController } from './canal.controller';
import { CanalService } from './canal.service';

describe('CanalController', () => {
  let controller: CanalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CanalController],
      providers: [CanalService],
    }).compile();

    controller = module.get<CanalController>(CanalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
