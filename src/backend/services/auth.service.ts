import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env, getAdminEmailSet } from '../config/env.ts';
import { userRepository } from '../repositories/user.repository.ts';
import { BadRequestError, ConflictError, UnauthorizedError } from '../utils/errors.ts';
import { sha256 } from '../utils/hash.ts';
import { isValidTimezone } from '../utils/timezone.ts';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  type: 'access';
}

function parseDurationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit];
}

export class AuthService {
  async register(input: {
    email: string;
    password: string;
    name?: string;
    timezone?: string;
    isAdult: boolean;
  }) {
    const timezone = input.timezone ?? 'UTC';
    if (!isValidTimezone(timezone)) {
      throw new BadRequestError(`Invalid timezone: ${timezone}`, 'INVALID_TIMEZONE');
    }

    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('An account with this email already exists', 'EMAIL_EXISTS');
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const role: UserRole = getAdminEmailSet().has(input.email.toLowerCase())
      ? UserRole.ADMIN
      : UserRole.USER;

    const user = await userRepository.create({
      email: input.email,
      passwordHash,
      name: input.name,
      timezone,
      isAdult: input.isAdult,
      role,
    });

    const tokens = await this.issueTokenPair(user.id, user.email, user.role);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        timezone: user.timezone,
        isAdult: user.isAdult,
      },
      ...tokens,
    };
  }

  async login(input: { email: string; password: string }) {
    const user = await userRepository.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const tokens = await this.issueTokenPair(user.id, user.email, user.role);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        timezone: user.timezone,
        isAdult: user.isAdult,
      },
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    let decoded: { sub: string; jti: string; type: string };
    try {
      decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as {
        sub: string;
        jti: string;
        type: string;
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }

    if (decoded.type !== 'refresh') {
      throw new UnauthorizedError('Invalid token type', 'INVALID_REFRESH_TOKEN');
    }

    const tokenHash = sha256(refreshToken);
    const stored = await userRepository.findRefreshTokenByHash(tokenHash);
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      throw new UnauthorizedError('Refresh token revoked or expired', 'REFRESH_TOKEN_REVOKED');
    }

    await userRepository.revokeRefreshToken(stored.id);
    const tokens = await this.issueTokenPair(stored.user.id, stored.user.email, stored.user.role);
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = sha256(refreshToken);
    const stored = await userRepository.findRefreshTokenByHash(tokenHash);
    if (stored && !stored.revokedAt) {
      await userRepository.revokeRefreshToken(stored.id);
    }
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
      if (payload.type !== 'access') {
        throw new UnauthorizedError('Invalid access token');
      }
      return payload;
    } catch {
      throw new UnauthorizedError('Invalid or expired access token', 'INVALID_ACCESS_TOKEN');
    }
  }

  private async issueTokenPair(userId: string, email: string, role: UserRole) {
    const accessToken = jwt.sign(
      { sub: userId, email, role, type: 'access' } satisfies AccessTokenPayload,
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );

    const jti = crypto.randomUUID();
    const refreshToken = jwt.sign(
      { sub: userId, jti, type: 'refresh' },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );

    const expiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN));
    await userRepository.createRefreshToken({
      userId,
      tokenHash: sha256(refreshToken),
      expiresAt,
    });

    return { accessToken, refreshToken };
  }
}

export const authService = new AuthService();
