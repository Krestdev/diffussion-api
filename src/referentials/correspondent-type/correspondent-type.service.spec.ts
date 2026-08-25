import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { CorrespondentTypeService } from './correspondent-type.service';

describe('CorrespondentTypeService', () => {
  let service: CorrespondentTypeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorrespondentTypeService,
        { provide: DatabaseService, useValue: {} },
      ],
    }).compile();

    service = module.get<CorrespondentTypeService>(CorrespondentTypeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
