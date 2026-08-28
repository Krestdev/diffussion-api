import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { CanalService } from './canal.service';

describe('CanalService', () => {
  let service: CanalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CanalService, { provide: DatabaseService, useValue: {} }],
    }).compile();

    service = module.get<CanalService>(CanalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
