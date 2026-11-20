import { CommitmentMode, MissedDayMode } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { commitmentController } from '../controllers/commitment.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';
import { validateBody } from '../middleware/validate.middleware.ts';

const createCommitmentSchema = z.object({
  trackId: z.string().min(1),
  startDate: z.string().datetime().optional(),
  durationDays: z.number().int().min(1).max(365),
  timezone: z.string().min(1).max(64).optional(),
  mode: z.nativeEnum(CommitmentMode),
  missedDayMode: z.nativeEnum(MissedDayMode),
  dailyPenaltyCents: z.number().int().min(0).default(100),
  finalFailPenaltyCents: z.number().int().min(0),
  depositCents: z.number().int().positive().optional(),
  maxTotalPenaltyCents: z.number().int().min(0),
  excusedDaysAllowed: z.number().int().min(0).default(2),
  currency: z.string().length(3).default('usd'),
  termsVersion: z.string().min(1),
  acknowledgePace: z.boolean().optional().default(false),
});

const submitFinalSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('EXAM'),
    submissionId: z.string().min(1),
    answers: z.array(
      z.object({
        questionId: z.string().min(1),
        answer: z.string(),
      }),
    ),
  }),
  z.object({
    type: z.literal('PROJECT'),
    projectUrl: z.string().url(),
    projectNotes: z.string().max(2000).optional(),
  }),
]);

const appealSchema = z.object({
  finalSubmissionId: z.string().min(1).optional(),
  reason: z.string().min(5).max(2000),
});

export const commitmentRouter = Router();

commitmentRouter.use(requireAuth);

commitmentRouter.post(
  '/',
  validateBody(createCommitmentSchema),
  asyncHandler((req, res) => commitmentController.create(req, res)),
);

commitmentRouter.get(
  '/',
  asyncHandler((req, res) => commitmentController.list(req, res)),
);

commitmentRouter.get(
  '/:id',
  asyncHandler((req, res) => commitmentController.getById(req, res)),
);

commitmentRouter.post(
  '/:id/final-exam/start',
  asyncHandler((req, res) => commitmentController.startFinalExam(req, res)),
);

commitmentRouter.post(
  '/:id/final-submission',
  validateBody(submitFinalSchema),
  asyncHandler((req, res) => commitmentController.submitFinal(req, res)),
);

commitmentRouter.post(
  '/:id/appeal',
  validateBody(appealSchema),
  asyncHandler((req, res) => commitmentController.createAppeal(req, res)),
);
