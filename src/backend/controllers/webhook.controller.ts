import { Request, Response } from 'express';
import { stripeService } from '../services/stripe.service.ts';

export class WebhookController {
  async handleStripeWebhook(req: Request, res: Response): Promise<void> {
    const signature = req.headers['stripe-signature'];
    const sigHeader = Array.isArray(signature) ? signature[0] : signature;
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
    const result = await stripeService.handleWebhook(rawBody, sigHeader);
    res.status(200).json(result);
  }
}

export const webhookController = new WebhookController();
