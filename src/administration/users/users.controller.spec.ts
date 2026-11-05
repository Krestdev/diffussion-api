import { Test, TestingModule } from '@nestjs/testing';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { MailerService } from '../../mail/mailer.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        UsersService,
        { provide: DatabaseService, useValue: {} },
        {
          provide: MailerService,
          useValue: { sendInvitation: jest.fn() },
        },
        {
          provide: RealtimeGateway,
          useValue: { emitToUsers: jest.fn(), broadcast: jest.fn() },
        },
        { provide: RbacService, useValue: {} },
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
