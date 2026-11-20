import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

export class TrackRepository {
  async findAllTracksWithDetails() {
    return prisma.track.findMany({
      orderBy: { order: 'asc' },
      include: {
        prerequisites: {
          include: {
            requiredTrack: {
              select: { id: true, slug: true, title: true, levelCount: true },
            },
          },
        },
        units: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true },
        },
      },
    });
  }

  async findBySlug(slug: string) {
    return prisma.track.findUnique({
      where: { slug },
      include: {
        prerequisites: {
          include: {
            requiredTrack: {
              select: { id: true, slug: true, title: true, levelCount: true },
            },
          },
        },
        units: {
          orderBy: { order: 'asc' },
          include: {
            levels: {
              orderBy: { number: 'asc' },
            },
          },
        },
      },
    });
  }

  async findById(id: string) {
    return prisma.track.findUnique({
      where: { id },
      include: {
        prerequisites: {
          include: {
            requiredTrack: {
              select: { id: true, slug: true, title: true, levelCount: true },
            },
          },
        },
      },
    });
  }

  async findLevelById(levelId: string) {
    return prisma.level.findUnique({
      where: { id: levelId },
      include: {
        unit: true,
        track: {
          include: {
            prerequisites: {
              include: {
                requiredTrack: true,
              },
            },
          },
        },
      },
    });
  }

  async findLevelByTrackAndNumber(trackId: string, number: number) {
    return prisma.level.findUnique({
      where: { trackId_number: { trackId, number } },
    });
  }

  async findLevelsByTrack(trackId: string) {
    return prisma.level.findMany({
      where: { trackId },
      orderBy: { number: 'asc' },
      include: { unit: true },
    });
  }

  async findUserPointsGrouped(userId: string) {
    return prisma.pointEvent.groupBy({
      by: ['trackId'],
      where: { userId },
      _sum: { points: true },
    });
  }

  async findUserPointEvents(userId: string) {
    return prisma.pointEvent.findMany({
      where: { userId },
      include: {
        track: { select: { id: true, slug: true, title: true, levelCount: true } },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  async findUserLevelProgress(userId: string, trackId?: string) {
    return prisma.userLevelProgress.findMany({
      where: { userId, ...(trackId ? { trackId } : {}) },
      include: { level: true },
    });
  }

  async findUserLevelProgressForLevel(userId: string, levelId: string) {
    return prisma.userLevelProgress.findUnique({
      where: { userId_levelId: { userId, levelId } },
    });
  }

  async upsertLevelPassed(
    data: {
      userId: string;
      levelId: string;
      trackId: string;
      viaPlacement: boolean;
      scorePct: number;
      passedAt?: Date;
    },
    tx: Prisma.TransactionClient = prisma,
  ) {
    const existing = await tx.userLevelProgress.findUnique({
      where: { userId_levelId: { userId: data.userId, levelId: data.levelId } },
    });
    if (existing) {
      return tx.userLevelProgress.update({
        where: { id: existing.id },
        data: {
          bestScorePct: Math.max(existing.bestScorePct, data.scorePct),
          viaPlacement: existing.viaPlacement && data.viaPlacement,
        },
      });
    }
    return tx.userLevelProgress.create({
      data: {
        userId: data.userId,
        levelId: data.levelId,
        trackId: data.trackId,
        viaPlacement: data.viaPlacement,
        bestScorePct: data.scorePct,
        passedAt: data.passedAt ?? new Date(),
      },
    });
  }

  async createPointEventIdempotent(
    data: { userId: string; trackId: string; levelNumber: number; points?: number },
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{ created: boolean; event: { id: string; points: number } }> {
    const existing = await tx.pointEvent.findUnique({
      where: {
        userId_trackId_levelNumber: {
          userId: data.userId,
          trackId: data.trackId,
          levelNumber: data.levelNumber,
        },
      },
    });
    if (existing) {
      return { created: false, event: existing };
    }
    try {
      const event = await tx.pointEvent.create({
        data: {
          userId: data.userId,
          trackId: data.trackId,
          levelNumber: data.levelNumber,
          points: data.points ?? 1,
        },
      });
      return { created: true, event };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await tx.pointEvent.findUniqueOrThrow({
          where: {
            userId_trackId_levelNumber: {
              userId: data.userId,
              trackId: data.trackId,
              levelNumber: data.levelNumber,
            },
          },
        });
        return { created: false, event: raced };
      }
      throw err;
    }
  }

  async createPlacementTest(data: {
    userId: string;
    trackId: string;
    targetUnitId: string;
    targetUnitOrder: number;
    questionIds: string[];
  }) {
    return prisma.placementTest.create({ data });
  }

  async findPlacementTestById(id: string) {
    return prisma.placementTest.findUnique({ where: { id } });
  }

  async updatePlacementTest(
    id: string,
    data: { status: 'PASSED' | 'FAILED'; scorePct: number; completedAt: Date },
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.placementTest.update({ where: { id }, data });
  }

  async countNonPlacementPassedLevelsInWindow(
    userId: string,
    trackId: string,
    from: Date,
    to: Date,
  ) {
    return prisma.userLevelProgress.findMany({
      where: {
        userId,
        trackId,
        viaPlacement: false,
        passedAt: { gte: from, lte: to },
      },
      select: { passedAt: true },
    });
  }
}

export const trackRepository = new TrackRepository();
