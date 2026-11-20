import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.ts';
import { gameService } from '../services/game.service.ts';

export class AttemptController {
  async startAttempt(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await gameService.startAttempt(req.user!.userId, req.params.id);
    res.status(201).json(result);
  }

  async submitAnswer(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await gameService.submitAnswer(req.user!.userId, req.params.id, req.body);
    res.status(200).json(result);
  }

  async finishAttempt(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await gameService.finishAttempt(req.user!.userId, req.params.id);
    res.status(200).json(result);
  }
}

export const attemptController = new AttemptController();
