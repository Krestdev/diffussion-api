import { Test, TestingModule } from '@nestjs/testing';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { CoreClient } from '../../core/core-client';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: {} },
        { provide: CoreClient, useValue: { configured: false } },
      ],
    })
      .overrideGuard(CoreAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
