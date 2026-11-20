import { Router } from 'express';
import { z } from 'zod';
import { meController } from '../controllers/me.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';
import { validateBody } from '../middleware/validate.middleware.ts';

const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(32),
  country: z.string().min(2).max(3).nullable().optional(),
});

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get(
  '/stats',
  asyncHandler((req, res) => meController.getStats(req, res)),
);

meRouter.get(
  '/points',
  asyncHandler((req, res) => meController.getPoints(req, res)),
);

meRouter.get(
  '/review-queue',
  asyncHandler((req, res) => meController.getReviewQueue(req, res)),
);

meRouter.patch(
  '/profile',
  validateBody(updateProfileSchema),
  asyncHandler((req, res) => meController.updateProfile(req, res)),
);
