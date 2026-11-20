import { Router } from 'express';
import { z } from 'zod';
import { attemptController } from '../controllers/attempt.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';
import { answerRateLimiter } from '../middleware/rateLimit.middleware.ts';
import { validateBody } from '../middleware/validate.middleware.ts';

const submitAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().min(1),
});

export const levelAttemptRouter = Router();
levelAttemptRouter.use(requireAuth);

levelAttemptRouter.post(
  '/:id/attempts',
  asyncHandler((req, res) => attemptController.startAttempt(req, res)),
);

export const attemptRouter = Router();
attemptRouter.use(requireAuth);

attemptRouter.post(
  '/:id/answers',
  answerRateLimiter,
  validateBody(submitAnswerSchema),
  asyncHandler((req, res) => attemptController.submitAnswer(req, res)),
);

attemptRouter.post(
  '/:id/finish',
  asyncHandler((req, res) => attemptController.finishAttempt(req, res)),
);
