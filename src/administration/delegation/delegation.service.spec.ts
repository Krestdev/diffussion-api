import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { DelegationService } from './delegation.service';

describe('DelegationService', () => {
  let service: DelegationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DelegationService,
        { provide: DatabaseService, useValue: {} },
      ],
    }).compile();

    service = module.get<DelegationService>(DelegationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
