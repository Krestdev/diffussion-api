import { Test, TestingModule } from '@nestjs/testing';
import { CanalService } from './canal.service';

describe('CanalService', () => {
  let service: CanalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CanalService],
    }).compile();

    service = module.get<CanalService>(CanalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
