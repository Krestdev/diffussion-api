import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../../activity/activity.service';
import { DatabaseService } from '../../database/database.service';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let service: ProjectService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectService,
        { provide: DatabaseService, useValue: {} },
        { provide: ActivityService, useValue: {} },
      ],
    }).compile();

    service = module.get<ProjectService>(ProjectService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
