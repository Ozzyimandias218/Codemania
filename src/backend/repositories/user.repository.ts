import { Prisma, User, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

export class UserRepository {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  }

  async create(data: {
    email: string;
    passwordHash: string;
    name?: string;
    timezone: string;
    isAdult: boolean;
    role: UserRole;
  }): Promise<User> {
    return prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
        name: data.name ?? null,
        timezone: data.timezone,
        isAdult: data.isAdult,
        role: data.role,
      },
    });
  }

  async updateStripeCustomerId(userId: string, stripeCustomerId: string): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId },
    });
  }

  async createRefreshToken(data: { userId: string; tokenHash: string; expiresAt: Date }) {
    return prisma.refreshToken.create({ data });
  }

  async findRefreshTokenByHash(tokenHash: string) {
    return prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  }

  async revokeRefreshToken(id: string) {
    return prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserRefreshTokens(userId: string) {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async incrementXp(userId: string, amount: number, tx: Prisma.TransactionClient = prisma) {
    return tx.user.update({
      where: { id: userId },
      data: { xp: { increment: amount } },
    });
  }

  async updateStreak(
    userId: string,
    data: { currentStreak: number; longestStreak: number; lastStreakDate: string },
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.user.update({
      where: { id: userId },
      data,
    });
  }
}

export const userRepository = new UserRepository();
