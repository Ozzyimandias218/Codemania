import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.ts';
import { dailyQuizService } from '../services/dailyQuiz.service.ts';
import { leaderboardService } from '../services/leaderboard.service.ts';

export class DailyQuizController {
  async getToday(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await dailyQuizService.getTodayState(req.user!.userId);
    res.status(200).json(result);
  }

  async start(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await dailyQuizService.startDailyQuiz(req.user!.userId);
    res.status(201).json(result);
  }

  async getQuestion(req: AuthenticatedRequest, res: Response): Promise<void> {
    const quizDate = typeof req.query.quizDate === 'string' ? req.query.quizDate : undefined;
    const result = await dailyQuizService.getCurrentQuestion(req.user!.userId, new Date(), quizDate);
    res.status(200).json(result);
  }

  async submitAnswer(req: AuthenticatedRequest, res: Response): Promise<void> {
    const result = await dailyQuizService.submitDailyAnswer(req.user!.userId, req.body);
    res.status(200).json(result);
  }

  async getResult(req: AuthenticatedRequest, res: Response): Promise<void> {
    const quizDate = typeof req.query.quizDate === 'string' ? req.query.quizDate : undefined;
    const result = await dailyQuizService.getDailyResult(req.user!.userId, quizDate);
    res.status(200).json(result);
  }

  async getLeaderboard(req: AuthenticatedRequest, res: Response): Promise<void> {
    const period = typeof req.query.period === 'string' ? req.query.period : 'daily';
    const periodKey = typeof req.query.periodKey === 'string' ? req.query.periodKey : undefined;
    const limit = typeof req.query.limit === 'number' ? req.query.limit : 20;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const result = await leaderboardService.getLeaderboard({
      period,
      periodKey,
      limit,
      cursor,
    });
    res.status(200).json(result);
  }

  async getMyLeaderboard(req: AuthenticatedRequest, res: Response): Promise<void> {
    const period = typeof req.query.period === 'string' ? req.query.period : 'daily';
    const periodKey = typeof req.query.periodKey === 'string' ? req.query.periodKey : undefined;
    const result = await leaderboardService.getMyRankAndNeighbors({
      userId: req.user!.userId,
      period,
      periodKey,
    });
    res.status(200).json(result);
  }
}

export const dailyQuizController = new DailyQuizController();
