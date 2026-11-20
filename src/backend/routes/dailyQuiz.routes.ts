import { Router } from 'express';
import { z } from 'zod';
import { dailyQuizController } from '../controllers/dailyQuiz.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { answerRateLimiter } from '../middleware/rateLimit.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';
import { validateBody, validateQuery } from '../middleware/validate.middleware.ts';

const dateQuerySchema = z.object({
  quizDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const submitDailyAnswerSchema = z.object({
  questionId: z.string().min(1),
  givenValue: z.union([z.string(), z.number(), z.null()]).optional(),
  quizDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const leaderboardQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'all-time']).default('daily'),
  periodKey: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

const leaderboardMeQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'all-time']).default('daily'),
  periodKey: z.string().min(1).optional(),
});

export const dailyRouter = Router();
dailyRouter.use(requireAuth);

dailyRouter.get(
  '/today',
  asyncHandler((req, res) => dailyQuizController.getToday(req, res)),
);

dailyRouter.post(
  '/start',
  asyncHandler((req, res) => dailyQuizController.start(req, res)),
);

dailyRouter.get(
  '/question',
  validateQuery(dateQuerySchema),
  asyncHandler((req, res) => dailyQuizController.getQuestion(req, res)),
);

dailyRouter.post(
  '/answer',
  answerRateLimiter,
  validateBody(submitDailyAnswerSchema),
  asyncHandler((req, res) => dailyQuizController.submitAnswer(req, res)),
);

dailyRouter.get(
  '/result',
  validateQuery(dateQuerySchema),
  asyncHandler((req, res) => dailyQuizController.getResult(req, res)),
);

export const leaderboardRouter = Router();

leaderboardRouter.get(
  '/',
  validateQuery(leaderboardQuerySchema),
  asyncHandler((req, res) => dailyQuizController.getLeaderboard(req, res)),
);

leaderboardRouter.get(
  '/me',
  requireAuth,
  validateQuery(leaderboardMeQuerySchema),
  asyncHandler((req, res) => dailyQuizController.getMyLeaderboard(req, res)),
);
