import { DisplayNameStatus, LeaderboardPeriod } from '@prisma/client';
import { env } from '../config/env.ts';
import { dailyQuizRepository } from '../repositories/dailyQuiz.repository.ts';
import { userRepository } from '../repositories/user.repository.ts';
import { BadRequestError } from '../utils/errors.ts';
import { getIsoWeekKey, moderateDisplayName } from '../utils/dailyQuiz.ts';
import { formatDateInTimezone } from '../utils/timezone.ts';

export interface LeaderboardCursor {
  score: number;
  timeMs: number;
  userId: string;
}

export function encodeLeaderboardCursor(cursor: LeaderboardCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeLeaderboardCursor(raw: string): LeaderboardCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed?.score === 'number' &&
      typeof parsed?.timeMs === 'number' &&
      typeof parsed?.userId === 'string'
    ) {
      return parsed as LeaderboardCursor;
    }
  } catch {
    // fall through
  }
  throw new BadRequestError('Invalid leaderboard cursor');
}

export function resolvePeriodAndKey(
  periodRaw: string,
  periodKeyInput?: string,
  now: Date = new Date(),
): { period: LeaderboardPeriod; periodKey: string } {
  const normalized = periodRaw.toLowerCase();
  const todayDate = formatDateInTimezone(now, env.DAILY_TZ);

  if (normalized === 'daily') {
    return {
      period: LeaderboardPeriod.DAILY,
      periodKey: periodKeyInput ?? todayDate,
    };
  }
  if (normalized === 'weekly') {
    return {
      period: LeaderboardPeriod.WEEKLY,
      periodKey: periodKeyInput ?? getIsoWeekKey(todayDate),
    };
  }
  if (normalized === 'all-time' || normalized === 'all_time') {
    return {
      period: LeaderboardPeriod.ALL_TIME,
      periodKey: 'ALL',
    };
  }
  throw new BadRequestError('period must be daily, weekly, or all-time');
}

export class LeaderboardService {
  async updateDisplayNameAndCountry(
    userId: string,
    input: { displayName: string; country?: string | null },
  ) {
    const moderation = moderateDisplayName(input.displayName);
    if (!moderation.approved) {
      await dailyQuizRepository.updateUserProfile(userId, {
        displayName: null,
        displayNameStatus: DisplayNameStatus.REJECTED,
        ...(input.country !== undefined ? { country: input.country } : {}),
      });
      throw new BadRequestError(
        moderation.reason ?? 'displayName failed moderation',
        'DISPLAY_NAME_REJECTED',
      );
    }

    return dailyQuizRepository.updateUserProfile(userId, {
      displayName: input.displayName.trim(),
      displayNameStatus: DisplayNameStatus.APPROVED,
      ...(input.country !== undefined ? { country: input.country } : {}),
    });
  }

  async getLeaderboard(params: {
    period: string;
    periodKey?: string;
    limit?: number;
    cursor?: string;
    now?: Date;
  }) {
    const { period, periodKey } = resolvePeriodAndKey(
      params.period,
      params.periodKey,
      params.now,
    );
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const decodedCursor = params.cursor ? decodeLeaderboardCursor(params.cursor) : null;

    const rows = await dailyQuizRepository.listLeaderboardEligible({
      period,
      periodKey,
      limit,
      cursor: decodedCursor,
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodeLeaderboardCursor({
            score: pageRows[pageRows.length - 1].score,
            timeMs: pageRows[pageRows.length - 1].timeMs,
            userId: pageRows[pageRows.length - 1].userId,
          })
        : null;

    return {
      period,
      periodKey,
      entries: pageRows.map((row) => ({
        userId: row.userId,
        displayName: row.user.displayName!,
        country: row.country ?? row.user.country ?? null,
        score: row.score,
        timeMs: row.timeMs,
        updatedAt: row.updatedAt,
      })),
      nextCursor,
    };
  }

  async getMyRankAndNeighbors(params: {
    userId: string;
    period: string;
    periodKey?: string;
    now?: Date;
  }) {
    const user = await userRepository.findById(params.userId);
    const { period, periodKey } = resolvePeriodAndKey(
      params.period,
      params.periodKey,
      params.now,
    );

    if (!user || !user.displayName || user.displayNameStatus !== DisplayNameStatus.APPROVED) {
      return {
        period,
        periodKey,
        eligible: false,
        reason: 'Approved displayName required to appear on leaderboards',
        rank: null,
        me: null,
        neighbors: [],
      };
    }

    const ordered = await dailyQuizRepository.findAllLeaderboardForRank(period, periodKey);
    const idx = ordered.findIndex((e) => e.userId === params.userId);
    if (idx === -1) {
      return {
        period,
        periodKey,
        eligible: true,
        rank: null,
        me: null,
        neighbors: [],
      };
    }

    const start = Math.max(0, idx - 2);
    const end = Math.min(ordered.length, idx + 3);
    const neighbors = ordered.slice(start, end).map((row, offset) => ({
      rank: start + offset + 1,
      userId: row.userId,
      displayName: row.user.displayName!,
      country: row.country ?? row.user.country ?? null,
      score: row.score,
      timeMs: row.timeMs,
      isMe: row.userId === params.userId,
    }));

    return {
      period,
      periodKey,
      eligible: true,
      rank: idx + 1,
      me: neighbors.find((n) => n.isMe) ?? null,
      neighbors,
    };
  }
}

export const leaderboardService = new LeaderboardService();
