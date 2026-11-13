import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { DatabaseService } from '../database/database.service';
import { MailerService } from '../mail/mailer.service';
import { RbacService } from './rbac/rbac.service';
import { UserStatus } from '../../generated/prisma/enums';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('AuthService — password reset', () => {
  let service: AuthService;
  let database: {
    user: Record<string, jest.Mock>;
    passwordResetToken: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let mailer: { sendPasswordReset: jest.Mock };

  beforeEach(async () => {
    database = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      passwordResetToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    mailer = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: DatabaseService, useValue: database },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        { provide: MailerService, useValue: mailer },
        { provide: RbacService, useValue: {} },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('forgotPassword', () => {
    it('issues a token and mails a link to an active user', async () => {
      database.user.findUnique.mockResolvedValue({
        id: 'u-1',
        name: 'Jane',
        email: 'jane@example.com',
        status: UserStatus.ACTIVE,
      });

      await service.forgotPassword({ email: 'jane@example.com' });

      expect(database.passwordResetToken.create).toHaveBeenCalled();
      const mail = mailer.sendPasswordReset.mock.calls[0][0] as {
        to: string;
        resetLink: string;
        expiresAt: Date;
      };
      expect(mail.to).toBe('jane@example.com');
      expect(mail.resetLink).toContain('/reset-password?token=');
      expect(mail.expiresAt.getTime()).toBeGreaterThan(Date.now());
      // The raw token is never persisted — only its digest.
      const created = database.passwordResetToken.create.mock.calls[0][0] as {
        data: { tokenHash: string };
      };
      const token = mail.resetLink.split('token=')[1];
      expect(created.data.tokenHash).toBe(sha256(token));
      expect(created.data.tokenHash).not.toBe(token);
    });

    it('stays silent for an unknown address (no account oracle)', async () => {
      database.user.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword({ email: 'nobody@example.com' }),
      ).resolves.toBeUndefined();

      expect(database.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('stays silent for a suspended account', async () => {
      database.user.findUnique.mockResolvedValue({
        id: 'u-1',
        name: 'Jane',
        email: 'jane@example.com',
        status: UserStatus.SUSPENDED,
      });

      await service.forgotPassword({ email: 'jane@example.com' });

      expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const NEW_PASSWORD = 'mock-reset-password-123';
    const activeGrant = (overrides: Record<string, unknown> = {}) => ({
      id: 'prt-1',
      userId: 'u-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 'u-1', status: UserStatus.ACTIVE },
      ...overrides,
    });

    it('sets the new password and ends every existing session', async () => {
      database.passwordResetToken.findUnique.mockResolvedValue(activeGrant());

      await service.resetPassword({
        token: 'raw-token',
        password: NEW_PASSWORD,
      });

      expect(database.passwordResetToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: sha256('raw-token') },
        }),
      );
      const update = database.user.update.mock.calls[0][0] as {
        data: { password: string; refreshToken: null };
      };
      expect(await bcrypt.compare(NEW_PASSWORD, update.data.password)).toBe(
        true,
      );
      expect(update.data.refreshToken).toBeNull();
      // Single use.
      expect(database.passwordResetToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prt-1' },
          data: expect.objectContaining({ usedAt: expect.any(Date) }),
        }),
      );
    });

    it('refuses an unknown token', async () => {
      database.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: 'nope', password: NEW_PASSWORD }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.user.update).not.toHaveBeenCalled();
    });

    it('refuses an expired token', async () => {
      database.passwordResetToken.findUnique.mockResolvedValue(
        activeGrant({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.resetPassword({ token: 'raw-token', password: NEW_PASSWORD }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.user.update).not.toHaveBeenCalled();
    });

    it('refuses a token that was already used', async () => {
      database.passwordResetToken.findUnique.mockResolvedValue(
        activeGrant({ usedAt: new Date() }),
      );

      await expect(
        service.resetPassword({ token: 'raw-token', password: NEW_PASSWORD }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(database.user.update).not.toHaveBeenCalled();
    });

    it('refuses a token whose account was suspended meanwhile', async () => {
      database.passwordResetToken.findUnique.mockResolvedValue(
        activeGrant({ user: { id: 'u-1', status: UserStatus.SUSPENDED } }),
      );

      await expect(
        service.resetPassword({ token: 'raw-token', password: NEW_PASSWORD }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(database.user.update).not.toHaveBeenCalled();
    });
  });
});
