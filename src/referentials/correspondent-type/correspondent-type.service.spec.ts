import { Test, TestingModule } from '@nestjs/testing';
import { ActivityService } from '../../activity/activity.service';
import { DatabaseService } from '../../database/database.service';
import { CorrespondentTypeService } from './correspondent-type.service';

describe('CorrespondentTypeService', () => {
  let service: CorrespondentTypeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorrespondentTypeService,
        { provide: DatabaseService, useValue: {} },
        { provide: ActivityService, useValue: {} },
      ],
    }).compile();

    service = module.get<CorrespondentTypeService>(CorrespondentTypeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
