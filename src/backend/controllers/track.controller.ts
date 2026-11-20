import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.ts';
import { trackService } from '../services/track.service.ts';

export class TrackController {
  async listTracks(req: AuthenticatedRequest, res: Response): Promise<void> {
    const tracks = await trackService.listTracksForUser(req.user!.userId);
    res.status(200).json({ tracks });
  }

  async getTrackLevels(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await trackService.getTrackLevelsForUser(req.user!.userId, req.params.slug);
    res.status(200).json(data);
  }

  async startPlacementTest(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await trackService.startPlacementTest(
      req.user!.userId,
      req.params.slug,
      req.body.targetUnitOrder,
    );
    res.status(201).json(data);
  }

  async submitPlacementTest(req: AuthenticatedRequest, res: Response): Promise<void> {
    const data = await trackService.submitPlacementTest(
      req.user!.userId,
      req.params.slug,
      req.params.testId,
      req.body.answers,
    );
    res.status(200).json(data);
  }
}

export const trackController = new TrackController();
