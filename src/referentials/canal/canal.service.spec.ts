import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../../activity/activity.service';
import { DatabaseService } from '../../database/database.service';
import { CanalService } from './canal.service';

describe('CanalService', () => {
  let service: CanalService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanalService,
        { provide: DatabaseService, useValue: {} },
        { provide: ActivityService, useValue: {} },
      ],
    }).compile();

    service = module.get<CanalService>(CanalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
