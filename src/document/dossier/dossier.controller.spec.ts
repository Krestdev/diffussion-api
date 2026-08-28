import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { DossierController } from './dossier.controller';
import { DossierService } from './dossier.service';

describe('DossierController', () => {
  let controller: DossierController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      close: jest.fn(),
      reopen: jest.fn(),
      archive: jest.fn(),
      getCourriers: jest.fn(),
      getInstructions: jest.fn(),
      getLivrables: jest.fn(),
      getHistorique: jest.fn(),
      getProgression: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DossierController],
      providers: [{ provide: DossierService, useValue: service }],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DossierController>(DossierController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('create() forwards the authenticated user as createdById', () => {
    controller.create(
      { title: 'X', siteId: 's-1' },
      {
        sub: 'u-1',
        email: 'u@x.com',
        refreshToken: 'r',
      },
    );
    expect(service.create).toHaveBeenCalledWith(
      { title: 'X', siteId: 's-1' },
      'u-1',
    );
  });

  it('close() delegates to the service', () => {
    controller.close('d-1');
    expect(service.close).toHaveBeenCalledWith('d-1');
  });
});
