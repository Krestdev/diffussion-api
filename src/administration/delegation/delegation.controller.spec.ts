import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { DelegationController } from './delegation.controller';
import { DelegationService } from './delegation.service';

describe('DelegationController', () => {
  let controller: DelegationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DelegationController],
      providers: [
        DelegationService,
        { provide: DatabaseService, useValue: {} },
      ],
    }).compile();

    controller = module.get<DelegationController>(DelegationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
