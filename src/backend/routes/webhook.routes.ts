import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller.ts';
import { requireAdmin, requireAuth } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';

export const webhookRouter = Router();

webhookRouter.post(
  '/stripe',
  asyncHandler((req, res) => webhookController.handleStripeWebhook(req, res)),
);

webhookRouter.get(
  '/stripe/events',
  requireAuth,
  requireAdmin,
  asyncHandler((req, res) => webhookController.listStripeWebhookEvents(req, res)),
);
