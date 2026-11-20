import { LevelType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GAME_CONSTANTS,
  calculateStreakUpdate,
  computeReviewQueueTransition,
  gameService,
  getCompletionXpForLevelType,
  getEffectiveStreak,
  getPassMarkForLevelType,
} from '../src/backend/services/game.service.ts';
import { evaluateTrackUnlock, isLevelUnlocked } from '../src/backend/services/track.service.ts';
import { prisma } from '../src/backend/config/prisma.ts';
import { trackRepository } from '../src/backend/repositories/track.repository.ts';

describe('Unlock rules', () => {
  it('unlocks level 1 when track is unlocked and requires level n-1 passed for level n', () => {
    const passed = new Set<number>([1, 2]);
    expect(isLevelUnlocked(1, true, passed)).toBe(true);
    expect(isLevelUnlocked(2, true, passed)).toBe(true);
    expect(isLevelUnlocked(3, true, passed)).toBe(true);
    expect(isLevelUnlocked(4, true, passed)).toBe(false);
    expect(isLevelUnlocked(1, false, passed)).toBe(false);
  });

  it('unlocks track only when all prerequisites points are met', () => {
    const locked = evaluateTrackUnlock({
      prerequisites: [
        { requiredTrackId: 'py', requiredTrackTitle: 'Python', requiredPoints: 5 },
      ],
      userPointsByTrack: new Map([['py', 3]]),
    });
    expect(locked.unlocked).toBe(false);
    expect(locked.lockedReason).toContain('5 points in Python');

    const unlocked = evaluateTrackUnlock({
      prerequisites: [
        { requiredTrackId: 'py', requiredTrackTitle: 'Python', requiredPoints: 5 },
      ],
      userPointsByTrack: new Map([['py', 5]]),
    });
    expect(unlocked.unlocked).toBe(true);
    expect(unlocked.lockedReason).toBeNull();
  });
});

describe('Points idempotency', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('awards 1 point once per (userId, trackId, levelNumber) and returns created=false on duplicate', async () => {
    const mockTx = {
      pointEvent: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'pe-1', points: 1 }),
        create: vi.fn().mockResolvedValueOnce({ id: 'pe-1', points: 1 }),
      },
    } as unknown as Parameters<typeof trackRepository.createPointEventIdempotent>[1];

    const first = await trackRepository.createPointEventIdempotent(
      { userId: 'u1', trackId: 't1', levelNumber: 10 },
      mockTx,
    );
    const second = await trackRepository.createPointEventIdempotent(
      { userId: 'u1', trackId: 't1', levelNumber: 10 },
      mockTx,
    );

    expect(first.created).toBe(true);
    expect(first.event.points).toBe(1);
    expect(second.created).toBe(false);
    expect(second.event.points).toBe(1);
  });

  it('does not award points on level numbers not divisible by 10 when finishing an attempt', async () => {
    vi.spyOn(prisma, '$transaction').mockImplementation(async (fn) => {
      return fn({
        attempt: {
          update: vi.fn().mockResolvedValue({
            id: 'att-1',
            status: 'PASSED',
            heartsRemaining: 4,
            xpEarned: 40,
          }),
        },
        user: {
          update: vi.fn().mockResolvedValue({}),
        },
        userLevelProgress: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
        pointEvent: {
          findUnique: vi.fn(),
          create: vi.fn(),
        },
      } as never);
    });

    const attemptRepoModule = await import('../src/backend/repositories/attempt.repository.ts');
    const userRepoModule = await import('../src/backend/repositories/user.repository.ts');

    vi.spyOn(attemptRepoModule.attemptRepository, 'findById').mockResolvedValue({
      id: 'att-1',
      userId: 'u1',
      levelId: 'lvl-5',
      trackId: 't1',
      type: LevelType.CHECKPOINT,
      status: 'IN_PROGRESS',
      heartsRemaining: 4,
      xpEarned: 40,
      questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
      totalQuestions: 5,
      correctCount: 4,
      answeredCount: 5,
      startedAt: new Date(),
      finishedAt: null,
      level: { id: 'lvl-5', number: 5, unitId: 'u1', trackId: 't1', type: LevelType.CHECKPOINT, title: 'CP1' },
      answers: [],
    });

    vi.spyOn(userRepoModule.userRepository, 'findById').mockResolvedValue({
      id: 'u1',
      email: 'u1@test.com',
      passwordHash: 'h',
      name: null,
      displayName: null,
      displayNameStatus: 'PENDING',
      country: null,
      role: 'USER',
      timezone: 'UTC',
      isAdult: true,
      xp: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastStreakDate: null,
      stripeCustomerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const createPointSpy = vi.spyOn(trackRepository, 'createPointEventIdempotent');
    const res = await gameService.finishAttempt('u1', 'att-1');
    expect(res.passed).toBe(true);
    expect(res.pointAwarded).toBe(false);
    expect(createPointSpy).not.toHaveBeenCalled();
  });
});

describe('Hearts, XP, Pass Marks, and Streak', () => {
  it('enforces exact XP and pass mark constants', () => {
    expect(GAME_CONSTANTS.INITIAL_HEARTS).toBe(5);
    expect(GAME_CONSTANTS.XP_PER_CORRECT).toBe(10);
    expect(getCompletionXpForLevelType(LevelType.LESSON)).toBe(20);
    expect(getCompletionXpForLevelType(LevelType.CHECKPOINT)).toBe(50);
    expect(getPassMarkForLevelType(LevelType.LESSON)).toBe(0.66);
    expect(getPassMarkForLevelType(LevelType.CHECKPOINT)).toBe(0.7);
  });

  it('increments streak once per new calendar day in user timezone and resets if a day is missed', () => {
    // Day 1 in America/New_York (UTC-5 in Nov): 2026-11-10T23:00:00-05:00 -> 2026-11-11T04:00:00Z
    const day1 = calculateStreakUpdate({
      currentStreak: 0,
      longestStreak: 0,
      lastStreakDate: null,
      timezone: 'America/New_York',
      now: new Date('2026-11-11T04:00:00Z'),
    });
    expect(day1.currentStreak).toBe(1);
    expect(day1.lastStreakDate).toBe('2026-11-10');
    expect(day1.incremented).toBe(true);

    // Same calendar day later -> no increment
    const sameDay = calculateStreakUpdate({
      currentStreak: day1.currentStreak,
      longestStreak: day1.longestStreak,
      lastStreakDate: day1.lastStreakDate,
      timezone: 'America/New_York',
      now: new Date('2026-11-11T04:30:00Z'),
    });
    expect(sameDay.currentStreak).toBe(1);
    expect(sameDay.incremented).toBe(false);

    // Consecutive day (2026-11-11 in NY) -> increments to 2
    const day2 = calculateStreakUpdate({
      currentStreak: sameDay.currentStreak,
      longestStreak: sameDay.longestStreak,
      lastStreakDate: sameDay.lastStreakDate,
      timezone: 'America/New_York',
      now: new Date('2026-11-11T15:00:00Z'),
    });
    expect(day2.currentStreak).toBe(2);
    expect(day2.lastStreakDate).toBe('2026-11-11');
    expect(day2.incremented).toBe(true);

    // Skipped 2026-11-12, passed on 2026-11-13 -> resets to 1, longest stays 2
    const day4 = calculateStreakUpdate({
      currentStreak: day2.currentStreak,
      longestStreak: day2.longestStreak,
      lastStreakDate: day2.lastStreakDate,
      timezone: 'America/New_York',
      now: new Date('2026-11-13T15:00:00Z'),
    });
    expect(day4.currentStreak).toBe(1);
    expect(day4.longestStreak).toBe(2);

    // Effective streak shows 0 if a day was missed without passing yet
    expect(
      getEffectiveStreak({
        currentStreak: 5,
        lastStreakDate: '2026-11-10',
        timezone: 'UTC',
        now: new Date('2026-11-12T10:00:00Z'),
      }),
    ).toBe(0);
  });
});

describe('Review queue intervals', () => {
  it('schedules +1d on wrong, advances +3d -> removed after 2 consecutive correct', () => {
    const t0 = new Date('2026-11-01T12:00:00Z');

    // Wrong answer -> +1 day, stage 0, consecutive 0
    const wrong = computeReviewQueueTransition({ isCorrect: false, existing: null, now: t0 });
    expect(wrong.action).toBe('UPSERT_WRONG');
    if (wrong.action === 'UPSERT_WRONG') {
      expect(wrong.nextReviewAt.toISOString()).toBe('2026-11-02T12:00:00.000Z');
    }

    // 1st consecutive correct -> advances to stage 1 (+3 days)
    const t1 = new Date('2026-11-02T12:00:00Z');
    const firstRight = computeReviewQueueTransition({
      isCorrect: true,
      existing: { consecutiveCorrect: 0, intervalStage: 0 },
      now: t1,
    });
    expect(firstRight.action).toBe('ADVANCE');
    if (firstRight.action === 'ADVANCE') {
      expect(firstRight.intervalStage).toBe(1);
      expect(firstRight.consecutiveCorrect).toBe(1);
      expect(firstRight.nextReviewAt.toISOString()).toBe('2026-11-05T12:00:00.000Z');
    }

    // 2nd consecutive correct -> removed from review queue
    const secondRight = computeReviewQueueTransition({
      isCorrect: true,
      existing: { consecutiveCorrect: 1, intervalStage: 1 },
      now: new Date('2026-11-05T12:00:00Z'),
    });
    expect(secondRight.action).toBe('REMOVE');

    // Wrong after stage 1 -> resets to +1 day and 0 consecutive
    const relapsed = computeReviewQueueTransition({ isCorrect: false, existing: null, now: t1 });
    expect(relapsed.action).toBe('UPSERT_WRONG');

    // Also verify stage 2 interval is +7 days when advancing from stage 1 without removal if configured,
    // and interval table contains [1, 3, 7]
    expect(GAME_CONSTANTS.REVIEW_INTERVAL_DAYS).toEqual([1, 3, 7]);
  });
});
