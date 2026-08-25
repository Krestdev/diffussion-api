import { Test, TestingModule } from '@nestjs/testing';
import { DossierTypeService } from './dossier-type.service';

describe('DossierTypeService', () => {
  let service: DossierTypeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DossierTypeService],
    }).compile();

    service = module.get<DossierTypeService>(DossierTypeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
