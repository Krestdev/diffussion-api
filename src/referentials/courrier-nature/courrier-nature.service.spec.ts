import { Test, TestingModule } from '@nestjs/testing';
import { CourrierNatureService } from './courrier-nature.service';

describe('CourrierNatureService', () => {
  let service: CourrierNatureService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CourrierNatureService],
    }).compile();

    service = module.get<CourrierNatureService>(CourrierNatureService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
