import { Test, TestingModule } from '@nestjs/testing';
import { CorrespondentTypeController } from './correspondent-type.controller';
import { CorrespondentTypeService } from './correspondent-type.service';

describe('CorrespondentTypeController', () => {
  let controller: CorrespondentTypeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CorrespondentTypeController],
      providers: [CorrespondentTypeService],
    }).compile();

    controller = module.get<CorrespondentTypeController>(CorrespondentTypeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
