import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.ts';
import { gameService } from '../services/game.service.ts';
import { leaderboardService } from '../services/leaderboard.service.ts';

export class MeController {
  async getStats(req: AuthenticatedRequest, res: Response): Promise<void> {
    const stats = await gameService.getMyStats(req.user!.userId);
    res.status(200).json(stats);
  }

  async getPoints(req: AuthenticatedRequest, res: Response): Promise<void> {
    const points = await gameService.getMyPoints(req.user!.userId);
    res.status(200).json(points);
  }

  async getReviewQueue(req: AuthenticatedRequest, res: Response): Promise<void> {
    const items = await gameService.getMyReviewQueue(req.user!.userId);
    res.status(200).json({ items });
  }

  async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    const profile = await leaderboardService.updateDisplayNameAndCountry(
      req.user!.userId,
      req.body,
    );
    res.status(200).json(profile);
  }
}

export const meController = new MeController();
