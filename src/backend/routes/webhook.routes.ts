import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';

export const webhookRouter = Router();

webhookRouter.post(
  '/stripe',
  asyncHandler((req, res) => webhookController.handleStripeWebhook(req, res)),
);
