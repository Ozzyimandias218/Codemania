import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.ts';
import { commitmentService } from '../services/commitment.service.ts';

export class CommitmentController {
  async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await commitmentService.createCommitment(req.user!.userId, req.body);
    res.status(201).json(result);
  }

  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    const commitments = await commitmentService.listMyCommitments(req.user!.userId);
    res.status(200).json({ commitments });
  }

  async getById(req: AuthenticatedRequest, res: Response): Promise<void> {
    const commitment = await commitmentService.getCommitment(req.user!.userId, req.params.id);
    res.status(200).json(commitment);
  }

  async startFinalExam(req: AuthenticatedRequest, res: Response): Promise<void> {
    const exam = await commitmentService.startFinalExam(req.user!.userId, req.params.id);
    res.status(201).json(exam);
  }

  async submitFinal(req: AuthenticatedRequest, res: Response): Promise<void> {
    const submission = await commitmentService.submitFinal(
      req.user!.userId,
      req.params.id,
      req.body,
    );
    res.status(201).json(submission);
  }

  async createAppeal(req: AuthenticatedRequest, res: Response): Promise<void> {
    const appeal = await commitmentService.createAppeal(
      req.user!.userId,
      req.params.id,
      req.body,
    );
    res.status(201).json(appeal);
  }
}

export const commitmentController = new CommitmentController();
