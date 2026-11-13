import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import { MailerService } from '../mail/mailer.service';
import { AuthService } from './auth.service';
import { RbacService } from './rbac/rbac.service';
import { UserStatus } from '../../generated/prisma/enums';

describe('AuthService — mandatory password change', () => {
  const CURRENT = 'Current@2026';
  let service: AuthService;
  let hash: string;
  let database: { user: Record<string, jest.Mock> };

  const account = (mustChangePassword: boolean) => ({
    id: 'u-1',
    email: 'a@b.c',
    password: hash,
    status: UserStatus.ACTIVE,
    mustChangePassword,
  });

  beforeAll(async () => {
    hash = await bcrypt.hash(CURRENT, 4);
  });

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-access-secret-not-used-in-production';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-not-used-in-production';
    database = {
      user: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DatabaseService, useValue: database },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('signed') },
        },
        { provide: MailerService, useValue: {} },
        { provide: RbacService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('tells at login that the password has to be changed', async () => {
    database.user.findUnique.mockResolvedValue(account(true));

    await expect(
      service.login({ email: 'a@b.c', password: CURRENT }),
    ).resolves.toMatchObject({ mustChangePassword: true });
  });

  it('clears the obligation and gives new tokens', async () => {
    database.user.findUniqueOrThrow.mockResolvedValue(account(true));

    const tokens = await service.changePassword('u-1', {
      currentPassword: CURRENT,
      newPassword: 'Another@2026',
    });

    const { data } = database.user.update.mock.calls[0][0] as {
      data: { password: string; mustChangePassword: boolean };
    };
    expect(data.mustChangePassword).toBe(false);
    await expect(bcrypt.compare('Another@2026', data.password)).resolves.toBe(
      true,
    );
    expect(tokens.accessToken).toBe('signed');
  });

  it('refuses a wrong current password', async () => {
    database.user.findUniqueOrThrow.mockResolvedValue(account(true));

    await expect(
      service.changePassword('u-1', {
        currentPassword: 'Wrong@2026',
        newPassword: 'Another@2026',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.user.update).not.toHaveBeenCalled();
  });

  it('refuses the same password again', async () => {
    database.user.findUniqueOrThrow.mockResolvedValue(account(true));

    await expect(
      service.changePassword('u-1', {
        currentPassword: CURRENT,
        newPassword: CURRENT,
      }),
    ).rejects.toThrow('différent');
    expect(database.user.update).not.toHaveBeenCalled();
  });
});
