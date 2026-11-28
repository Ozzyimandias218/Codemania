import { StripeWebhookEventStatus } from '@prisma/client';
import { Request, Response } from 'express';
import { z } from 'zod';
import { stripeService } from '../services/stripe.service.ts';

const listWebhookEventsQuerySchema = z.object({
  status: z
    .enum(['ALL', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED'])
    .optional()
    .default('ALL'),
  type: z.string().trim().max(120).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export class WebhookController {
  async handleStripeWebhook(req: Request, res: Response): Promise<void> {
    const signature = req.headers['stripe-signature'];
    const sigHeader = Array.isArray(signature) ? signature[0] : signature;
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
    const result = await stripeService.handleWebhook(rawBody, sigHeader);
    res.status(200).json(result);
  }

  async listStripeWebhookEvents(req: Request, res: Response): Promise<void> {
    const parsed = listWebhookEventsQuerySchema.parse(req.query);
    const result = await stripeService.listWebhookEvents({
      status:
        parsed.status === 'ALL'
          ? undefined
          : (parsed.status as StripeWebhookEventStatus),
      type: parsed.type || undefined,
      search: parsed.search || undefined,
      limit: parsed.limit,
    });

    res.status(200).json({
      events: result.events.map((evt) => ({
        id: evt.id,
        type: evt.type,
        status: evt.status,
        commitmentId: evt.commitmentId,
        summary: evt.summary,
        errorMessage: evt.errorMessage,
        duplicateCount: evt.duplicateCount,
        receivedAt: evt.receivedAt.toISOString(),
        processedAt: evt.processedAt ? evt.processedAt.toISOString() : null,
        lastDuplicateAt: evt.lastDuplicateAt ? evt.lastDuplicateAt.toISOString() : null,
      })),
      counts: result.counts,
      source: result.source,
    });
  }
}

export const webhookController = new WebhookController();
