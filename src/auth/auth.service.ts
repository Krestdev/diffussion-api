import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DatabaseService } from '../database/database.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthTokens, JwtPayload } from './types/jwt-payload.type';
import { UserStatus } from 'generated/prisma/enums';

const SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwtService: JwtService,
  ) { }

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.database.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email is already in use');
    }

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.database.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hashedPassword,
        status: UserStatus.ACTIVE,
      },
    });

    return this.issueTokens(user.id, user.email);
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

    return this.issueTokens(user.id, user.email);
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

    const refreshTokenMatches = await bcrypt.compare(
      refreshToken,
      user.refreshToken,
    );
    if (!refreshTokenMatches) {
      throw new UnauthorizedException('Access denied');
    }

    return this.issueTokens(user.id, user.email);
  }

  async logout(userUuid: string): Promise<void> {
    await this.database.user.update({
      where: { id: userUuid },
      data: { refreshToken: null },
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
          },
        },
        assignments: { include: { site: true } },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, refreshToken, userRoles, assignments, ...rest } = user;
    const roles = userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        userRoles.flatMap((ur) =>
          ur.role.rolePermissions.map((rp) => rp.permission.code),
        ),
      ),
    ];

    return {
      ...rest,
      roles,
      permissions,
      sites: assignments.map((a) => a.site),
    };
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
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userUuid, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.requireEnv('JWT_SECRET'),
        expiresIn: (process.env.JWT_EXPIRES_IN ??
          '15m') as JwtSignOptions['expiresIn'],
      }),
      this.jwtService.signAsync(payload, {
        secret: this.requireEnv('JWT_REFRESH_SECRET'),
        expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ??
          '7d') as JwtSignOptions['expiresIn'],
      }),
    ]);

    const hashedRefreshToken = await bcrypt.hash(refreshToken, SALT_ROUNDS);
    await this.database.user.update({
      where: { id: userUuid },
      data: { refreshToken: hashedRefreshToken },
    });

    return { accessToken, refreshToken };
  }
}
