import { Router } from 'express';
import { z } from 'zod';
import { trackController } from '../controllers/track.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';
import { validateBody } from '../middleware/validate.middleware.ts';

const startPlacementSchema = z.object({
  targetUnitOrder: z.number().int().min(2),
});

const submitPlacementSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        answer: z.string(),
      }),
    )
    .min(1),
});

export const trackRouter = Router();

trackRouter.use(requireAuth);

trackRouter.get(
  '/',
  asyncHandler((req, res) => trackController.listTracks(req, res)),
);

trackRouter.get(
  '/:slug/levels',
  asyncHandler((req, res) => trackController.getTrackLevels(req, res)),
);

trackRouter.post(
  '/:slug/placement-test',
  validateBody(startPlacementSchema),
  asyncHandler((req, res) => trackController.startPlacementTest(req, res)),
);

trackRouter.post(
  '/:slug/placement-test/:testId/submit',
  validateBody(submitPlacementSchema),
  asyncHandler((req, res) => trackController.submitPlacementTest(req, res)),
);
