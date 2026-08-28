import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { DatabaseService } from '../../database/database.service';
import { CorrespondentTypeController } from './correspondent-type.controller';
import { CorrespondentTypeService } from './correspondent-type.service';

describe('CorrespondentTypeController', () => {
  let controller: CorrespondentTypeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CorrespondentTypeController],
      providers: [
        CorrespondentTypeService,
        { provide: DatabaseService, useValue: {} },
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CorrespondentTypeController>(
      CorrespondentTypeController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
