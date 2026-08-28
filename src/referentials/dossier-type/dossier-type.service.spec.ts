import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { DossierTypeService } from './dossier-type.service';

describe('DossierTypeService', () => {
  let service: DossierTypeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DossierTypeService,
        { provide: DatabaseService, useValue: {} },
      ],
    }).compile();

    service = module.get<DossierTypeService>(DossierTypeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
