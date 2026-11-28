import {
  AristotleTemplateKey,
  DailyQuestionOrigin,
  DailyQuestionStatus,
  DailyQuestionType,
  FinalSubmissionStatus,
  QuestionOrigin,
  QuestionStatus,
  QuestionType,
} from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { adminController } from '../controllers/admin.controller.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';
import { validateBody, validateQuery } from '../middleware/validate.middleware.ts';
import { BadRequestError } from '../utils/errors.ts';

const listQuestionsQuerySchema = z.object({
  status: z.nativeEnum(QuestionStatus).optional(),
  origin: z.nativeEnum(QuestionOrigin).optional(),
  levelId: z.string().min(1).optional(),
});

const createQuestionSchema = z.object({
  levelId: z.string().min(1),
  type: z.nativeEnum(QuestionType),
  prompt: z.string().min(1),
  codeSnippet: z.string().nullable().optional(),
  spokenText: z.string().nullable().optional(),
  options: z.array(z.string().min(1)).nullable().optional(),
  answer: z.string().min(1),
  explanation: z.string().min(1),
  origin: z.nativeEnum(QuestionOrigin).default(QuestionOrigin.AUTHORED),
  sourceUrl: z.string().url().nullable().optional(),
  license: z.string().min(1).nullable().optional(),
  status: z.nativeEnum(QuestionStatus).optional(),
});

const editQuestionSchema = z.object({
  prompt: z.string().min(1).optional(),
  codeSnippet: z.string().nullable().optional(),
  spokenText: z.string().nullable().optional(),
  options: z.array(z.string().min(1)).nullable().optional(),
  answer: z.string().min(1).optional(),
  explanation: z.string().min(1).optional(),
  sourceUrl: z.string().url().nullable().optional(),
  license: z.string().min(1).nullable().optional(),
  reason: z.string().min(1).optional(),
});

const reviewQuestionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().min(1),
});

const listFinalSubmissionsQuerySchema = z.object({
  status: z.nativeEnum(FinalSubmissionStatus).optional(),
});

const auditLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const reviewFinalSubmissionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNotes: z.string().min(1),
  resolveAppealId: z.string().min(1).optional(),
});

const voidPenaltySchema = z.object({
  reason: z.string().min(3),
});

const manualRefundSchema = z.object({
  amountCents: z.number().int().positive().optional(),
});

const listDailyQuestionsQuerySchema = z.object({
  status: z.nativeEnum(DailyQuestionStatus).optional(),
  isReserve: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  dailyQuizId: z.string().min(1).optional(),
});

const createDailyQuestionSchema = z.object({
  type: z.nativeEnum(DailyQuestionType),
  prompt: z.string().min(5),
  codeSnippet: z.string().nullable().optional(),
  spokenText: z.string().nullable().optional(),
  options: z.array(z.string().min(1)).nullable().optional(),
  correctAnswer: z.string().min(1).optional(),
  numericAnswer: z.number().nullable().optional(),
  scale: z.number().nullable().optional(),
  explanation: z.string().min(1),
  sourceUrl: z.string().url().nullable().optional(),
  license: z.string().min(1).nullable().optional(),
  generatedBy: z.nativeEnum(DailyQuestionOrigin).default(DailyQuestionOrigin.HUMAN),
  isReserve: z.boolean().optional(),
  dailyQuizId: z.string().min(1).nullable().optional(),
  position: z.number().int().min(1).max(7).nullable().optional(),
  isFactualClaim: z.boolean().optional(),
  isCodeOutput: z.boolean().optional(),
});

const upsertTemplateSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  language: z.string().min(2).max(10).optional(),
  voiceId: z.string().min(1).optional(),
});

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get(
  '/questions',
  validateQuery(listQuestionsQuerySchema),
  asyncHandler((req, res) => adminController.listQuestions(req, res)),
);

adminRouter.post(
  '/questions',
  validateBody(createQuestionSchema),
  asyncHandler((req, res) => adminController.createQuestion(req, res)),
);

adminRouter.patch(
  '/questions/:id',
  validateBody(editQuestionSchema),
  asyncHandler((req, res) => adminController.editQuestion(req, res)),
);

adminRouter.post(
  '/questions/:id/review',
  validateBody(reviewQuestionSchema),
  asyncHandler((req, res) => adminController.reviewQuestion(req, res)),
);

adminRouter.get(
  '/audit-logs',
  validateQuery(auditLogsQuerySchema),
  asyncHandler((req, res) => adminController.listAuditLogs(req, res)),
);

adminRouter.get(
  '/final-submissions',
  validateQuery(listFinalSubmissionsQuerySchema),
  asyncHandler((req, res) => adminController.listFinalSubmissions(req, res)),
);

adminRouter.post(
  '/final-submissions/:id/review',
  validateBody(reviewFinalSubmissionSchema),
  asyncHandler((req, res) => adminController.reviewFinalSubmission(req, res)),
);

adminRouter.post(
  '/commitments/:id/penalties/:penaltyId/void',
  validateBody(voidPenaltySchema),
  asyncHandler((req, res) => adminController.voidPenalty(req, res)),
);

adminRouter.post(
  '/commitments/:id/refund-deposit',
  validateBody(manualRefundSchema),
  asyncHandler((req, res) => adminController.refundDeposit(req, res)),
);

// Zugzwang ("Aristotle") Admin Routes
adminRouter.get(
  '/daily/questions',
  validateQuery(listDailyQuestionsQuerySchema),
  asyncHandler((req, res) => adminController.listDailyQuestions(req, res)),
);

adminRouter.post(
  '/daily/questions',
  validateBody(createDailyQuestionSchema),
  asyncHandler((req, res) => adminController.submitDailyQuestionCandidate(req, res)),
);

adminRouter.post(
  '/daily/questions/:id/review',
  validateBody(reviewQuestionSchema),
  asyncHandler((req, res) => adminController.reviewDailyQuestion(req, res)),
);

adminRouter.get(
  '/daily/buffer',
  asyncHandler((req, res) => adminController.getDailyBuffer(req, res)),
);

adminRouter.get(
  '/daily/reserve',
  asyncHandler((req, res) => adminController.listDailyReserve(req, res)),
);

adminRouter.post(
  '/daily/quizzes/:quizDate/publish',
  asyncHandler((req, res) => adminController.publishDailyQuiz(req, res)),
);

adminRouter.post(
  '/daily/scheduler/run',
  asyncHandler((req, res) => adminController.runDailyScheduler(req, res)),
);

adminRouter.get(
  '/daily/templates',
  asyncHandler((req, res) => adminController.listAristotleTemplates(req, res)),
);

adminRouter.put(
  '/daily/templates/:key',
  (req, _res, next) => {
    const validKeys = Object.values(AristotleTemplateKey) as string[];
    if (!validKeys.includes(req.params.key)) {
      next(new BadRequestError(`Invalid AristotleTemplateKey: ${req.params.key}`));
      return;
    }
    next();
  },
  validateBody(upsertTemplateSchema),
  asyncHandler((req, res) => adminController.upsertAristotleTemplate(req, res)),
);

adminRouter.get(
  '/daily/alerts',
  asyncHandler((req, res) => adminController.listDailyAlerts(req, res)),
);

adminRouter.post(
  '/daily/alerts/:id/resolve',
  asyncHandler((req, res) => adminController.resolveDailyAlert(req, res)),
);
