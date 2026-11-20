import {
  AristotleTemplateKey,
  DailyQuestionStatus,
  FinalSubmissionStatus,
  QuestionOrigin,
  QuestionStatus,
} from '@prisma/client';
import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.ts';
import { adminService } from '../services/admin.service.ts';
import { dailyQuizService } from '../services/dailyQuiz.service.ts';
import { stripeService } from '../services/stripe.service.ts';

export class AdminController {
  async listQuestions(req: AuthenticatedRequest, res: Response): Promise<void> {
    const status = req.query.status as QuestionStatus | undefined;
    const origin = req.query.origin as QuestionOrigin | undefined;
    const levelId = req.query.levelId as string | undefined;
    const questions = await adminService.listQuestions({ status, origin, levelId });
    res.status(200).json({ questions });
  }

  async createQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const question = await adminService.createQuestion(req.user!.userId, req.body);
    res.status(201).json(question);
  }

  async editQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const question = await adminService.editQuestion(req.user!.userId, req.params.id, req.body);
    res.status(200).json(question);
  }

  async reviewQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const question = await adminService.reviewQuestion(
      req.user!.userId,
      req.params.id,
      req.body,
    );
    res.status(200).json(question);
  }

  async listAuditLogs(req: AuthenticatedRequest, res: Response): Promise<void> {
    const limit = typeof req.query.limit === 'number' ? req.query.limit : 100;
    const logs = await adminService.listAuditLogs(limit);
    res.status(200).json({ logs });
  }

  async listFinalSubmissions(req: AuthenticatedRequest, res: Response): Promise<void> {
    const status = req.query.status as FinalSubmissionStatus | undefined;
    const submissions = await adminService.listFinalSubmissions(status);
    res.status(200).json({ submissions });
  }

  async reviewFinalSubmission(req: AuthenticatedRequest, res: Response): Promise<void> {
    const submission = await adminService.reviewFinalSubmission(
      req.user!.userId,
      req.params.id,
      req.body,
    );
    res.status(200).json(submission);
  }

  async voidPenalty(req: AuthenticatedRequest, res: Response): Promise<void> {
    const penalty = await adminService.voidPenalty(
      req.user!.userId,
      req.params.id,
      req.params.penaltyId,
      req.body.reason,
    );
    res.status(200).json(penalty);
  }

  async refundDeposit(req: AuthenticatedRequest, res: Response): Promise<void> {
    const refund = await stripeService.manualRefundDeposit(req.params.id, req.body.amountCents);
    res.status(200).json(refund);
  }

  // Daily Quiz: Aristotle Admin Operations
  async listDailyQuestions(req: AuthenticatedRequest, res: Response): Promise<void> {
    const status = req.query.status as DailyQuestionStatus | undefined;
    const isReserve =
      typeof req.query.isReserve === 'boolean' ? req.query.isReserve : undefined;
    const dailyQuizId = req.query.dailyQuizId as string | undefined;
    const questions = await dailyQuizService.listQuestions({
      status,
      isReserve,
      dailyQuizId,
    });
    res.status(200).json({ questions });
  }

  async submitDailyQuestionCandidate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const question = await dailyQuizService.submitQuestionCandidate(
      req.user!.userId,
      req.body,
    );
    res.status(201).json(question);
  }

  async reviewDailyQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const question = await dailyQuizService.reviewQuestion(
      req.user!.userId,
      req.params.id,
      req.body,
    );
    res.status(200).json(question);
  }

  async getDailyBuffer(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const overview = await dailyQuizService.getBufferOverview();
    res.status(200).json(overview);
  }

  async listDailyReserve(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const reserve = await dailyQuizService.listReservePool();
    res.status(200).json(reserve);
  }

  async publishDailyQuiz(req: AuthenticatedRequest, res: Response): Promise<void> {
    const quiz = await dailyQuizService.manualPublishQuiz(
      req.user!.userId,
      req.params.quizDate,
    );
    res.status(200).json(quiz);
  }

  async runDailyScheduler(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const summary = await dailyQuizService.runDailyScheduler();
    res.status(200).json(summary);
  }

  async listAristotleTemplates(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const templates = await dailyQuizService.listAristotleTemplates();
    res.status(200).json({ templates });
  }

  async upsertAristotleTemplate(req: AuthenticatedRequest, res: Response): Promise<void> {
    const key = req.params.key as AristotleTemplateKey;
    const result = await dailyQuizService.upsertAristotleTemplate(
      req.user!.userId,
      key,
      req.body,
    );
    res.status(200).json(result);
  }

  async listDailyAlerts(_req: AuthenticatedRequest, res: Response): Promise<void> {
    const alerts = await dailyQuizService.listOpenAlerts();
    res.status(200).json({ alerts });
  }

  async resolveDailyAlert(req: AuthenticatedRequest, res: Response): Promise<void> {
    const alert = await dailyQuizService.resolveAlert(req.params.id);
    res.status(200).json(alert);
  }
}

export const adminController = new AdminController();
