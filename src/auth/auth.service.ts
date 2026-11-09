import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { RbacService } from './rbac/rbac.service';
import { DatabaseService } from '../database/database.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailerService } from '../mail/mailer.service';
import { AuthTokens, JwtPayload } from './types/jwt-payload.type';
import {
  ContractStatus,
  DossierStatus,
  ProjectStatus,
  SiteStatus,
  UserStatus,
} from 'generated/prisma/enums';

const SALT_ROUNDS = 10;
const RESET_TOKEN_TTL_MINUTES = Number(
  process.env.PASSWORD_RESET_TTL_MINUTES ?? 60,
);

// Refresh tokens are stored as a SHA-256 digest, not a bcrypt hash: bcrypt
// only reads the first 72 bytes of its input, and every JWT issued to the
// same user shares that prefix (header + `{"sub":"<uuid>`), so a bcrypt
// hash of the latest token also matched every older one and rotation never
// revoked anything. A JWT is already high-entropy, so a fast digest is
// sufficient here.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function tokenMatchesHash(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly mailer: MailerService,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Step 1 of the reset flow. Always resolves the same way — an unknown or
   * suspended address must not be distinguishable from a known one, or the
   * endpoint becomes an account oracle. Any previously issued token is
   * dropped, so only the latest link works.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.database.user.findUnique({
      where: { email: dto.email },
      select: { id: true, name: true, email: true, status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      return;
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000,
    );

    await this.database.$transaction([
      this.database.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      }),
      this.database.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
      }),
    ]);

    // CORS_ORIGINS may be "*" (any origin) — not a usable link base.
    const firstCorsOrigin = process.env.CORS_ORIGINS?.split(',')[0]?.trim();
    const baseUrl = (
      process.env.APP_WEB_URL ??
      (firstCorsOrigin && firstCorsOrigin !== '*'
        ? firstCorsOrigin
        : undefined) ??
      'http://localhost:4000'
    ).replace(/\/$/, '');

    await this.mailer.sendPasswordReset({
      to: user.email,
      name: user.name,
      resetLink: `${baseUrl}/reset-password?token=${token}`,
      expiresAt,
    });
  }

  /**
   * Step 2. The token is single-use and short-lived; consuming it also ends
   * every existing session (refresh token dropped) — whoever triggered the
   * reset may be locking an intruder out.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const grant = await this.database.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      include: { user: { select: { id: true, status: true } } },
    });
    if (!grant || grant.usedAt || grant.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'This reset link is invalid or has expired',
      );
    }
    this.assertActive(grant.user.status);

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);
    await this.database.$transaction([
      this.database.user.update({
        where: { id: grant.userId },
        data: {
          password: hashedPassword,
          refreshToken: null,
          isConnected: false,
        },
      }),
      this.database.passwordResetToken.update({
        where: { id: grant.id },
        data: { usedAt: new Date() },
      }),
      this.database.passwordResetToken.deleteMany({
        where: { userId: grant.userId, usedAt: null },
      }),
    ]);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.database.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Checked only after the password so the account's status is never
    // disclosed to someone who doesn't know its credentials.
    this.assertActive(user.status);

    return this.issueTokens(user.id, user.email, {
      lastLogin: new Date(),
      isConnected: true,
    });
  }

  async refreshTokens(
    userUuid: string,
    refreshToken: string,
  ): Promise<AuthTokens> {
    const user = await this.database.user.findUnique({
      where: { id: userUuid },
    });
    if (!user?.refreshToken) {
      throw new UnauthorizedException('Access denied');
    }

    if (!tokenMatchesHash(refreshToken, user.refreshToken)) {
      throw new UnauthorizedException('Access denied');
    }

    this.assertActive(user.status);

    return this.issueTokens(user.id, user.email);
  }

  async logout(userUuid: string): Promise<void> {
    await this.database.user.update({
      where: { id: userUuid },
      data: { refreshToken: null, isConnected: false },
    });
  }

  // The current user's own profile, including the roles/sites the frontend
  // needs to render the sidebar and gate UI without a separate call into
  // the (permission-gated) administration/users endpoints.
  async me(userUuid: string) {
    const user = await this.database.user.findUniqueOrThrow({
      where: { id: userUuid },
      include: {
        userRoles: {
          include: {
            role: {
              include: { rolePermissions: { include: { permission: true } } },
            },
            site: { select: { id: true, name: true } },
          },
        },
        site: true,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, refreshToken, userRoles, ...rest } = user;
    // One UserRole row per site: a role held at several sites is listed once.
    const roles = [...new Set(userRoles.map((ur) => ur.role.name))];
    // Held somewhere, by a role or by being a site's responsible.
    const permissions = await this.rbac.getPermissionCodes(userUuid);

    return {
      ...rest,
      roles,
      // Where each role is held: `site` null means global (every site).
      roleGrants: userRoles.map((ur) => ({
        role: { id: ur.role.id, name: ur.role.name },
        site: ur.site,
      })),
      // Held somewhere — kept for the existing menu checks.
      permissions,
      // What applies at each site (global + bySite[siteId]), delegations
      // included: what an action on a given resource is checked against.
      sitePermissions: await this.rbac.permissionsBySite(userUuid),
      ...(await this.designations(userUuid)),
    };
  }

  // What the user is the designated responsible of — only what is still
  // live (a closed or archived dossier, an archived contract or project, an
  // inactive site no longer counts).
  private async designations(userId: string) {
    const [sites, projects, contracts, dossiers] = await Promise.all([
      this.database.site.findMany({
        where: { responsibleId: userId, status: SiteStatus.ACTIVE },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.database.project.findMany({
        where: {
          responsibleId: userId,
          status: { not: ProjectStatus.ARCHIVED },
        },
        select: { id: true, name: true, reference: true },
        orderBy: { name: 'asc' },
      }),
      this.database.contract.findMany({
        where: { responsibleId: userId, status: ContractStatus.ACTIVE },
        select: { id: true, number: true, reference: true, title: true },
        orderBy: { number: 'asc' },
      }),
      this.database.dossier.findMany({
        where: {
          responsibleId: userId,
          status: { notIn: [DossierStatus.CLOSED, DossierStatus.ARCHIVED] },
        },
        select: { id: true, number: true, title: true },
        orderBy: { number: 'asc' },
      }),
    ]);
    return {
      isDesignatedResponsible:
        sites.length + projects.length + contracts.length + dossiers.length > 0,
      responsibleOf: { sites, projects, contracts, dossiers },
    };
  }

  private assertActive(status: UserStatus): void {
    if (status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account is suspended');
    }
  }

  private requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  }

  private async issueTokens(
    userUuid: string,
    email: string,
    extraUserData: { lastLogin?: Date; isConnected?: boolean } = {},
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userUuid, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, typ: 'access' },
        {
          secret: this.requireEnv('JWT_SECRET'),
          expiresIn: (process.env.JWT_EXPIRES_IN ??
            '15m') as JwtSignOptions['expiresIn'],
        },
      ),
      this.jwtService.signAsync(
        { ...payload, typ: 'refresh' },
        {
          secret: this.requireEnv('JWT_REFRESH_SECRET'),
          expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ??
            '7d') as JwtSignOptions['expiresIn'],
        },
      ),
    ]);

    await this.database.user.update({
      where: { id: userUuid },
      data: { refreshToken: hashToken(refreshToken), ...extraUserData },
    });

    return { accessToken, refreshToken };
  }
}
