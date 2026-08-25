import { Test, TestingModule } from '@nestjs/testing';
import { DossierTypeController } from './dossier-type.controller';
import { DossierTypeService } from './dossier-type.service';

describe('DossierTypeController', () => {
  let controller: DossierTypeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DossierTypeController],
      providers: [DossierTypeService],
    }).compile();

    controller = module.get<DossierTypeController>(DossierTypeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
