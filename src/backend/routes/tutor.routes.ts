import { Response, Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.ts';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';
import { tutorRateLimiter } from '../middleware/rateLimit.middleware.ts';
import { validateBody } from '../middleware/validate.middleware.ts';
import { questionRepository } from '../repositories/question.repository.ts';
import { reviewQueueRepository } from '../repositories/reviewQueue.repository.ts';
import { trackRepository } from '../repositories/track.repository.ts';
import { userRepository } from '../repositories/user.repository.ts';
import { getPythonCodingChallenge } from '../services/codingLessons.ts';
import {
  calculateStreakUpdate,
  getCompletionXpForLevelType,
} from '../services/game.service.ts';
import { runPythonTestCases } from '../services/pythonRunner.service.ts';
import { evaluateTrackUnlock, isLevelUnlocked } from '../services/track.service.ts';
import { tutorService } from '../services/tutor.service.ts';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.ts';

export const tutorSubmitSchema = z.object({
  levelId: z.string().min(1, 'levelId is required'),
  code: z
    .string()
    .trim()
    .min(1, 'Please write some Python code before submitting.')
    .max(3000, 'Code submission must be 3000 characters or fewer.'),
});

export const tutorRouter = Router();

tutorRouter.get(
  '/challenge/:levelId',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const level = await trackRepository.findLevelById(req.params.levelId);
    if (!level) throw new NotFoundError('Level not found');
    if (level.track.slug !== 'python') {
      throw new BadRequestError('Python AI Code Tutor is available for Python track steps.');
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

    const challenge = getPythonCodingChallenge(level.number);
    res.status(200).json({
      levelId: level.id,
      levelNumber: level.number,
      levelTitle: challenge.title,
      trackSlug: level.track.slug,
      lessonGoal: challenge.lessonGoal,
      starterCode: challenge.starterCode,
      testCases: challenge.testCases.map((t) => ({
        id: t.id,
        description: t.description,
        expected: t.expectedDisplay,
      })),
    });
  }),
);

tutorRouter.post(
  '/',
  requireAuth,
  tutorRateLimiter,
  validateBody(tutorSubmitSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const { levelId, code } = req.body as z.infer<typeof tutorSubmitSchema>;

    const level = await trackRepository.findLevelById(levelId);
    if (!level) throw new NotFoundError('Level not found');
    if (level.track.slug !== 'python') {
      throw new BadRequestError('Python AI Code Tutor is available for Python track steps.');
    }

    const [groupedPoints, userProgress, user] = await Promise.all([
      trackRepository.findUserPointsGrouped(userId),
      trackRepository.findUserLevelProgress(userId, level.trackId),
      userRepository.findById(userId),
    ]);
    if (!user) throw new NotFoundError('User not found');

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

    const challenge = getPythonCodingChallenge(level.number);
    const runResult = await runPythonTestCases(code, challenge.testCases);
    const tutor = await tutorService.evaluateSubmission({
      lessonGoal: challenge.lessonGoal,
      levelTitle: challenge.title,
      code,
      runResult,
    });

    const now = new Date();
    const scorePct = tutor.score / 100;
    const existingProgress = await trackRepository.findUserLevelProgressForLevel(userId, level.id);
    const nextLevel = await trackRepository.findLevelByTrackAndNumber(
      level.trackId,
      level.number + 1,
    );

    let levelPassed = Boolean(existingProgress);
    let newlyCompleted = false;
    let xpAwarded = 0;
    let totalXp = user.xp;
    let pointAwarded = false;
    let reviewEnqueued = false;
    let streakRes = {
      current: user.currentStreak,
      longest: user.longestStreak,
      incrementedToday: false,
    };

    if (tutor.nextAction === 'advance' && runResult.allPassed) {
      const txResult = await prisma.$transaction(async (tx) => {
        const isFirstCompletion = !existingProgress;
        const awardedXp = isFirstCompletion ? getCompletionXpForLevelType(level.type) : 0;

        await trackRepository.upsertLevelPassed(
          {
            userId,
            levelId: level.id,
            trackId: level.trackId,
            viaPlacement: false,
            scorePct,
            passedAt: now,
          },
          tx,
        );

        let updatedXp = user.xp;
        if (awardedXp > 0) {
          const updatedUser = await userRepository.incrementXp(userId, awardedXp, tx);
          updatedXp = updatedUser.xp;
        }

        const nextStreak = calculateStreakUpdate({
          currentStreak: user.currentStreak,
          longestStreak: user.longestStreak,
          lastStreakDate: user.lastStreakDate,
          timezone: user.timezone,
          now,
        });
        await userRepository.updateStreak(
          userId,
          {
            currentStreak: nextStreak.currentStreak,
            longestStreak: nextStreak.longestStreak,
            lastStreakDate: nextStreak.lastStreakDate,
          },
          tx,
        );

        let createdPoint = false;
        if (level.number % 10 === 0) {
          const pointRes = await trackRepository.createPointEventIdempotent(
            {
              userId,
              trackId: level.trackId,
              levelNumber: level.number,
              points: 1,
            },
            tx,
          );
          createdPoint = pointRes.created;
        }

        return {
          isFirstCompletion,
          awardedXp,
          updatedXp,
          createdPoint,
          nextStreak,
        };
      });

      levelPassed = true;
      newlyCompleted = txResult.isFirstCompletion;
      xpAwarded = txResult.awardedXp;
      totalXp = txResult.updatedXp;
      pointAwarded = txResult.createdPoint;
      streakRes = {
        current: txResult.nextStreak.currentStreak,
        longest: txResult.nextStreak.longestStreak,
        incrementedToday: txResult.nextStreak.incremented,
      };
    } else if (tutor.nextAction === 'review') {
      const lvlQuestions = await questionRepository.findApprovedByLevel(level.id);
      if (lvlQuestions.length > 0) {
        const q = lvlQuestions[0];
        const existingRq = await reviewQueueRepository.findByUserAndQuestion(userId, q.id);
        if (!existingRq) {
          await reviewQueueRepository.upsertWrong({
            userId,
            questionId: q.id,
            nextReviewAt: now,
            now,
          });
          reviewEnqueued = true;
        }
      }
    }

    res.status(200).json({
      levelId: level.id,
      levelNumber: level.number,
      lessonGoal: challenge.lessonGoal,
      testResults: runResult,
      tutor,
      progressUpdate: {
        levelPassed,
        newlyCompleted,
        xpAwarded,
        totalXp,
        pointAwarded,
        streak: streakRes,
        nextLevelId: nextLevel?.id ?? null,
        nextLevelNumber: nextLevel?.number ?? null,
        reviewEnqueued,
      },
    });
  }),
);
