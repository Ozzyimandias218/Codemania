import { AttemptStatus, LevelType, QuestionStatus } from '@prisma/client';
import { prisma } from '../config/prisma.ts';
import { attemptRepository } from '../repositories/attempt.repository.ts';
import { questionRepository } from '../repositories/question.repository.ts';
import { reviewQueueRepository } from '../repositories/reviewQueue.repository.ts';
import { trackRepository } from '../repositories/track.repository.ts';
import { userRepository } from '../repositories/user.repository.ts';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../utils/errors.ts';
import { shuffleArray } from '../utils/shuffle.ts';
import { formatDateInTimezone, previousCalendarDay } from '../utils/timezone.ts';
import { checkpointService } from './checkpoint.service.ts';
import { evaluateTrackUnlock, isLevelUnlocked, sanitizePublicQuestion } from './track.service.ts';

export const GAME_CONSTANTS = {
  INITIAL_HEARTS: 5,
  XP_PER_CORRECT: 10,
  XP_LESSON_COMPLETION: 20,
  XP_CHECKPOINT_COMPLETION: 50,
  LESSON_PASS_MARK: 0.66,
  CHECKPOINT_PASS_MARK: 0.7,
  REVIEW_INTERVAL_DAYS: [1, 3, 7] as const,
  REVIEW_CONSECUTIVE_REQUIRED: 2,
  MAX_DUE_REVIEW_IN_LESSON: 3,
} as const;

export function getPassMarkForLevelType(type: LevelType): number {
  return type === LevelType.CHECKPOINT
    ? GAME_CONSTANTS.CHECKPOINT_PASS_MARK
    : GAME_CONSTANTS.LESSON_PASS_MARK;
}

export function getCompletionXpForLevelType(type: LevelType): number {
  return type === LevelType.CHECKPOINT
    ? GAME_CONSTANTS.XP_CHECKPOINT_COMPLETION
    : GAME_CONSTANTS.XP_LESSON_COMPLETION;
}

export function calculateStreakUpdate(params: {
  currentStreak: number;
  longestStreak: number;
  lastStreakDate: string | null;
  timezone: string;
  now: Date;
}): {
  currentStreak: number;
  longestStreak: number;
  lastStreakDate: string;
  incremented: boolean;
} {
  const todayLocal = formatDateInTimezone(params.now, params.timezone);
  const yesterdayLocal = previousCalendarDay(todayLocal);

  if (params.lastStreakDate === todayLocal) {
    return {
      currentStreak: params.currentStreak,
      longestStreak: params.longestStreak,
      lastStreakDate: todayLocal,
      incremented: false,
    };
  }

  const nextStreak =
    params.lastStreakDate === yesterdayLocal ? params.currentStreak + 1 : 1;
  const nextLongest = Math.max(params.longestStreak, nextStreak);

  return {
    currentStreak: nextStreak,
    longestStreak: nextLongest,
    lastStreakDate: todayLocal,
    incremented: true,
  };
}

export function getEffectiveStreak(params: {
  currentStreak: number;
  lastStreakDate: string | null;
  timezone: string;
  now: Date;
}): number {
  if (!params.lastStreakDate) return 0;
  const todayLocal = formatDateInTimezone(params.now, params.timezone);
  const yesterdayLocal = previousCalendarDay(todayLocal);
  if (params.lastStreakDate === todayLocal || params.lastStreakDate === yesterdayLocal) {
    return params.currentStreak;
  }
  return 0;
}

export type ReviewQueueTransition =
  | { action: 'UPSERT_WRONG'; intervalStage: 0; consecutiveCorrect: 0; nextReviewAt: Date }
  | { action: 'REMOVE' }
  | {
      action: 'ADVANCE';
      intervalStage: number;
      consecutiveCorrect: number;
      nextReviewAt: Date;
    }
  | { action: 'NOOP' };

export function computeReviewQueueTransition(params: {
  isCorrect: boolean;
  existing: { consecutiveCorrect: number; intervalStage: number } | null;
  now: Date;
}): ReviewQueueTransition {
  if (!params.isCorrect) {
    const nextReviewAt = new Date(
      params.now.getTime() + GAME_CONSTANTS.REVIEW_INTERVAL_DAYS[0] * 86_400_000,
    );
    return {
      action: 'UPSERT_WRONG',
      intervalStage: 0,
      consecutiveCorrect: 0,
      nextReviewAt,
    };
  }

  if (!params.existing) {
    return { action: 'NOOP' };
  }

  const nextConsecutive = params.existing.consecutiveCorrect + 1;
  if (nextConsecutive >= GAME_CONSTANTS.REVIEW_CONSECUTIVE_REQUIRED) {
    return { action: 'REMOVE' };
  }

  const nextStage = Math.min(
    params.existing.intervalStage + 1,
    GAME_CONSTANTS.REVIEW_INTERVAL_DAYS.length - 1,
  );
  const days = GAME_CONSTANTS.REVIEW_INTERVAL_DAYS[nextStage];
  const nextReviewAt = new Date(params.now.getTime() + days * 86_400_000);

  return {
    action: 'ADVANCE',
    intervalStage: nextStage,
    consecutiveCorrect: nextConsecutive,
    nextReviewAt,
  };
}

export class GameService {
  async startAttempt(userId: string, levelId: string) {
    const level = await trackRepository.findLevelById(levelId);
    if (!level) {
      throw new NotFoundError('Level not found');
    }

    const [groupedPoints, userProgress] = await Promise.all([
      trackRepository.findUserPointsGrouped(userId),
      trackRepository.findUserLevelProgress(userId, level.trackId),
    ]);

    const pointsMap = new Map(groupedPoints.map((r) => [r.trackId, r._sum.points ?? 0]));
    const { unlocked: trackUnlocked, lockedReason } = evaluateTrackUnlock({
      prerequisites: level.track.prerequisites.map((p) => ({
        requiredTrackId: p.requiredTrackId,
        requiredTrackTitle: p.requiredTrack.title,
        requiredPoints: p.requiredPoints,
      })),
      userPointsByTrack: pointsMap,
    });

    if (!trackUnlocked) {
      throw new ForbiddenError(lockedReason ?? 'Track is locked', 'TRACK_LOCKED');
    }

    const passedNumbers = new Set(userProgress.map((p) => p.level.number));
    if (!isLevelUnlocked(level.number, trackUnlocked, passedNumbers)) {
      throw new ForbiddenError(
        `Level ${level.number} is locked until level ${level.number - 1} is passed`,
        'LEVEL_LOCKED',
      );
    }

    let questions;
    if (level.type === LevelType.CHECKPOINT) {
      questions = await checkpointService.generateCheckpointQuestions({
        userId,
        trackId: level.trackId,
        checkpointLevelNumber: level.number,
      });
    } else {
      const levelQuestions = await questionRepository.findApprovedByLevel(level.id);
      if (levelQuestions.length === 0) {
        throw new BadRequestError('Level has no approved questions yet');
      }

      // Include due review-queue questions from this track (+1d, +3d, +7d returns)
      const dueReviewItems = await reviewQueueRepository.findDueByUserAndTrack(
        userId,
        level.trackId,
        new Date(),
      );
      const levelQuestionIds = new Set(levelQuestions.map((q) => q.id));
      const extraDueQuestions = dueReviewItems
        .map((item) => item.question)
        .filter((q) => !levelQuestionIds.has(q.id))
        .slice(0, GAME_CONSTANTS.MAX_DUE_REVIEW_IN_LESSON);

      questions = shuffleArray([...levelQuestions, ...extraDueQuestions]);
    }

    const attempt = await attemptRepository.create({
      userId,
      levelId: level.id,
      trackId: level.trackId,
      type: level.type,
      questionIds: questions.map((q) => q.id),
      totalQuestions: questions.length,
      heartsRemaining: GAME_CONSTANTS.INITIAL_HEARTS,
    });

    return {
      attemptId: attempt.id,
      levelId: level.id,
      levelNumber: level.number,
      levelType: level.type,
      heartsRemaining: attempt.heartsRemaining,
      totalQuestions: attempt.totalQuestions,
      passMark: getPassMarkForLevelType(level.type),
      questions: questions.map(sanitizePublicQuestion),
    };
  }

  async submitAnswer(
    userId: string,
    attemptId: string,
    input: { questionId: string; answer: string },
  ) {
    const attempt = await attemptRepository.findById(attemptId);
    if (!attempt || attempt.userId !== userId) {
      throw new NotFoundError('Attempt not found');
    }
    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictError(`Attempt is already ${attempt.status}`, 'ATTEMPT_CLOSED');
    }

    const servedIds = attempt.questionIds as string[];
    if (!servedIds.includes(input.questionId)) {
      throw new BadRequestError('Question does not belong to this attempt');
    }

    const existingSub = await attemptRepository.findSubmission(attempt.id, input.questionId);
    if (existingSub) {
      throw new ConflictError('Question already answered in this attempt', 'DUPLICATE_ANSWER');
    }

    const question = await questionRepository.findById(input.questionId);
    if (!question || question.status !== QuestionStatus.APPROVED) {
      throw new NotFoundError('Approved question not found');
    }

    const isCorrect = input.answer.trim() === question.answer.trim();
    const newHearts = isCorrect ? attempt.heartsRemaining : Math.max(0, attempt.heartsRemaining - 1);
    const xpDelta = isCorrect ? GAME_CONSTANTS.XP_PER_CORRECT : 0;
    const failedByHearts = newHearts === 0;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updatedAttempt = await attemptRepository.recordAnswerAndUpdateAttempt(
        {
          attemptId: attempt.id,
          userId,
          questionId: question.id,
          submittedAnswer: input.answer.trim(),
          isCorrect,
          newHearts,
          xpDelta,
          newStatus: failedByHearts ? AttemptStatus.FAILED : AttemptStatus.IN_PROGRESS,
          finishedAt: failedByHearts ? now : undefined,
        },
        tx,
      );

      if (xpDelta > 0) {
        await userRepository.incrementXp(userId, xpDelta, tx);
      }

      const existingQueueItem = await reviewQueueRepository.findByUserAndQuestion(
        userId,
        question.id,
        tx,
      );
      const transition = computeReviewQueueTransition({
        isCorrect,
        existing: existingQueueItem,
        now,
      });

      if (transition.action === 'UPSERT_WRONG') {
        await reviewQueueRepository.upsertWrong(
          {
            userId,
            questionId: question.id,
            nextReviewAt: transition.nextReviewAt,
            now,
          },
          tx,
        );
      } else if (transition.action === 'REMOVE' && existingQueueItem) {
        await reviewQueueRepository.deleteById(existingQueueItem.id, tx);
      } else if (transition.action === 'ADVANCE' && existingQueueItem) {
        await reviewQueueRepository.updateProgress(
          existingQueueItem.id,
          {
            consecutiveCorrect: transition.consecutiveCorrect,
            intervalStage: transition.intervalStage,
            nextReviewAt: transition.nextReviewAt,
            lastReviewedAt: now,
          },
          tx,
        );
      }

      return updatedAttempt;
    });

    return {
      attemptId: result.id,
      questionId: question.id,
      isCorrect,
      correctAnswer: question.answer,
      explanation: question.explanation,
      heartsRemaining: result.heartsRemaining,
      xpDelta,
      attemptXpEarned: result.xpEarned,
      attemptStatus: result.status,
      answeredCount: result.answeredCount,
      totalQuestions: result.totalQuestions,
    };
  }

  async finishAttempt(userId: string, attemptId: string) {
    const attempt = await attemptRepository.findById(attemptId);
    if (!attempt || attempt.userId !== userId) {
      throw new NotFoundError('Attempt not found');
    }

    if (attempt.status !== AttemptStatus.IN_PROGRESS) {
      throw new ConflictError(`Attempt is already ${attempt.status}`, 'ATTEMPT_CLOSED');
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const scorePct =
      attempt.totalQuestions > 0 ? attempt.correctCount / attempt.totalQuestions : 0;
    const passMark = getPassMarkForLevelType(attempt.type);
    const passed = attempt.heartsRemaining > 0 && scorePct >= passMark;
    const finalStatus = passed ? AttemptStatus.PASSED : AttemptStatus.FAILED;
    const completionXp = passed ? getCompletionXpForLevelType(attempt.type) : 0;
    const now = new Date();

    const outcome = await prisma.$transaction(async (tx) => {
      const updatedAttempt = await attemptRepository.finalizeAttempt(
        {
          attemptId: attempt.id,
          status: finalStatus,
          xpDelta: completionXp,
          finishedAt: now,
        },
        tx,
      );

      let pointAwarded = false;
      let streakResult: {
        currentStreak: number;
        longestStreak: number;
        lastStreakDate: string | null;
        incremented: boolean;
      } = {
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        lastStreakDate: user.lastStreakDate,
        incremented: false,
      };

      if (passed) {
        if (completionXp > 0) {
          await userRepository.incrementXp(userId, completionXp, tx);
        }

        await trackRepository.upsertLevelPassed(
          {
            userId,
            levelId: attempt.levelId,
            trackId: attempt.trackId,
            viaPlacement: false,
            scorePct,
            passedAt: now,
          },
          tx,
        );

        const updatedStreak = calculateStreakUpdate({
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak,
          lastStreakDate: user.lastStreakDate,
          timezone: user.timezone,
          now,
        });
        streakResult = updatedStreak;

        await userRepository.updateStreak(
          userId,
          {
            currentStreak: updatedStreak.currentStreak,
            longestStreak: updatedStreak.longestStreak,
            lastStreakDate: updatedStreak.lastStreakDate,
          },
          tx,
        );

        // Award 1 point iff levelNumber % 10 === 0, once per (user, track, levelNumber)
        if (attempt.level.number % 10 === 0) {
          const pointRes = await trackRepository.createPointEventIdempotent(
            {
              userId,
              trackId: attempt.trackId,
              levelNumber: attempt.level.number,
              points: 1,
            },
            tx,
          );
          pointAwarded = pointRes.created;
        }
      }

      return { updatedAttempt, pointAwarded, streakResult };
    });

    return {
      attemptId: outcome.updatedAttempt.id,
      status: outcome.updatedAttempt.status,
      passed,
      scorePct,
      passMark,
      heartsRemaining: outcome.updatedAttempt.heartsRemaining,
      completionXpAwarded: completionXp,
      totalAttemptXp: outcome.updatedAttempt.xpEarned,
      pointAwarded: outcome.pointAwarded,
      streak: {
        current: outcome.streakResult.currentStreak,
        longest: outcome.streakResult.longestStreak,
        incrementedToday: outcome.streakResult.incremented,
      },
    };
  }

  async getMyStats(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    const [pointEvents, progress] = await Promise.all([
      trackRepository.findUserPointEvents(userId),
      trackRepository.findUserLevelProgress(userId),
    ]);

    const totalPoints = pointEvents.reduce((acc, e) => acc + e.points, 0);
    const effectiveStreak = getEffectiveStreak({
      currentStreak: user.currentStreak,
      lastStreakDate: user.lastStreakDate,
      timezone: user.timezone,
      now: new Date(),
    });

    return {
      userId: user.id,
      xp: user.xp,
      currentStreak: effectiveStreak,
      longestStreak: user.longestStreak,
      lastStreakDate: user.lastStreakDate,
      timezone: user.timezone,
      totalPoints,
      passedLevelsCount: progress.length,
    };
  }

  async getMyPoints(userId: string) {
    const [events, tracks] = await Promise.all([
      trackRepository.findUserPointEvents(userId),
      trackRepository.findAllTracksWithDetails(),
    ]);

    const byTrack = new Map<string, number>();
    for (const ev of events) {
      byTrack.set(ev.trackId, (byTrack.get(ev.trackId) ?? 0) + ev.points);
    }

    return {
      totalPoints: events.reduce((sum, e) => sum + e.points, 0),
      byTrack: tracks.map((t) => ({
        trackId: t.id,
        slug: t.slug,
        title: t.title,
        userPoints: byTrack.get(t.id) ?? 0,
        maxPoints: Math.floor(t.levelCount / 10),
      })),
      events: events.map((e) => ({
        id: e.id,
        trackId: e.trackId,
        trackSlug: e.track.slug,
        levelNumber: e.levelNumber,
        points: e.points,
        createdAt: e.createdAt,
      })),
    };
  }

  async getMyReviewQueue(userId: string) {
    const items = await reviewQueueRepository.findByUser(userId);
    const now = new Date();
    return items.map((item) => ({
      id: item.id,
      questionId: item.questionId,
      wrongCount: item.wrongCount,
      consecutiveCorrect: item.consecutiveCorrect,
      intervalStage: item.intervalStage,
      nextReviewAt: item.nextReviewAt,
      isDue: item.nextReviewAt <= now,
      lastReviewedAt: item.lastReviewedAt,
      question: {
        id: item.question.id,
        levelId: item.question.levelId,
        type: item.question.type,
        prompt: item.question.prompt,
      },
    }));
  }
}

export const gameService = new GameService();
