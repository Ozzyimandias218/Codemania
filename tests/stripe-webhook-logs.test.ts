import http from 'node:http';
import { CommitmentMode, CommitmentStatus, StripeWebhookEventStatus, UserRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/backend/app.ts';
import { env } from '../src/backend/config/env.ts';
import { commitmentRepository } from '../src/backend/repositories/commitment.repository.ts';
import { StripeGateway, StripeService } from '../src/backend/services/stripe.service.ts';
import { setWebhookSandboxMode } from '../src/backend/services/webhookLogStore.ts';

function signTestToken(role: UserRole, email: string): string {
  return jwt.sign(
    {
      sub: `test-${role.toLowerCase()}`,
      email,
      role,
      type: 'access',
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: '1h' },
  );
}

describe('Stripe webhook router logs & status tracking', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp({ useSandboxFallback: true });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral test server');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    setWebhookSandboxMode(false);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    setWebhookSandboxMode(true);
  });

  it('requires authentication and ADMIN role on GET /webhooks/stripe/events', async () => {
    const unauth = await fetch(`${baseUrl}/webhooks/stripe/events`);
    expect(unauth.status).toBe(401);

    const userToken = signTestToken(UserRole.USER, 'learner@codemania.dev');
    const nonAdmin = await fetch(`${baseUrl}/webhooks/stripe/events`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(nonAdmin.status).toBe(403);
  });

  it('lists recent Stripe webhook logs and supports status and search filtering for admins', async () => {
    const adminToken = signTestToken(UserRole.ADMIN, 'admin@codemania.dev');

    const allRes = await fetch(`${baseUrl}/webhooks/stripe/events`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(allRes.status).toBe(200);
    const allBody = (await allRes.json()) as {
      events: Array<{ id: string; type: string; status: string; commitmentId: string | null }>;
      counts: { total: number; processed: number; failed: number; ignored: number; processing: number };
      source: string;
    };
    expect(allBody.source).toBe('sandbox-memory');
    expect(allBody.events.length).toBeGreaterThanOrEqual(4);
    expect(allBody.counts.total).toBe(allBody.events.length);

    const failedRes = await fetch(`${baseUrl}/webhooks/stripe/events?status=FAILED`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(failedRes.status).toBe(200);
    const failedBody = (await failedRes.json()) as typeof allBody;
    expect(failedBody.events.length).toBeGreaterThanOrEqual(1);
    expect(failedBody.events.every((evt) => evt.status === 'FAILED')).toBe(true);

    const searchRes = await fetch(
      `${baseUrl}/webhooks/stripe/events?search=checkout.session.completed`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(searchRes.status).toBe(200);
    const searchBody = (await searchRes.json()) as typeof allBody;
    expect(searchBody.events.length).toBeGreaterThanOrEqual(1);
    expect(searchBody.events.every((evt) => evt.type === 'checkout.session.completed')).toBe(true);
  });

  it('records PROCESSED, IGNORED, duplicate, and FAILED statuses in StripeService.handleWebhook', async () => {
    setWebhookSandboxMode(false);
    const prevSecret = env.STRIPE_WEBHOOK_SECRET;
    env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';

    try {
      const gateway: StripeGateway = {
        createCustomer: vi.fn(),
        createSetupCheckoutSession: vi.fn(),
        createDepositPaymentIntent: vi.fn(),
        createOffSessionPenaltyPaymentIntent: vi.fn(),
        createManualRefund: vi.fn(),
        constructWebhookEvent: vi
          .fn()
          .mockReturnValueOnce({
            id: 'evt_test_processed_1',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_test_1', setup_intent: 'seti_1' } },
          })
          .mockReturnValueOnce({
            id: 'evt_test_processed_1',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_test_1', setup_intent: 'seti_1' } },
          })
          .mockReturnValueOnce({
            id: 'evt_test_ignored_1',
            type: 'invoice.upcoming',
            data: { object: {} },
          })
          .mockReturnValueOnce({
            id: 'evt_test_failed_1',
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_test_err', setup_intent: 'seti_err' } },
          }),
      };

      const service = new StripeService(gateway);
      const recordSpy = vi
        .spyOn(commitmentRepository, 'recordWebhookEventIfNew')
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);
      const dupSpy = vi.spyOn(commitmentRepository, 'markWebhookEventDuplicate').mockResolvedValue();
      const updateResultSpy = vi.spyOn(commitmentRepository, 'updateWebhookEventResult').mockResolvedValue();
      vi.spyOn(commitmentRepository, 'findByCheckoutSessionId')
        .mockResolvedValueOnce({
          id: 'cm_test_1',
          mode: CommitmentMode.PENALTY,
          status: CommitmentStatus.PENDING_PAYMENT_METHOD,
        } as never)
        .mockRejectedValueOnce(new Error('DB connection lost during checkout update'));
      vi.spyOn(commitmentRepository, 'update').mockResolvedValue({} as never);

      // 1. PROCESSED
      const first = await service.handleWebhook(Buffer.from('{}'), 'sig_1');
      expect(first).toEqual({ received: true, duplicate: false });
      expect(updateResultSpy).toHaveBeenNthCalledWith(
        1,
        'evt_test_processed_1',
        expect.objectContaining({
          status: StripeWebhookEventStatus.PROCESSED,
          commitmentId: 'cm_test_1',
          errorMessage: null,
        }),
      );

      // 2. DUPLICATE
      const dup = await service.handleWebhook(Buffer.from('{}'), 'sig_2');
      expect(dup).toEqual({ received: true, duplicate: true });
      expect(dupSpy).toHaveBeenCalledWith('evt_test_processed_1');

      // 3. IGNORED
      const ignored = await service.handleWebhook(Buffer.from('{}'), 'sig_3');
      expect(ignored).toEqual({ received: true, duplicate: false });
      expect(updateResultSpy).toHaveBeenNthCalledWith(
        2,
        'evt_test_ignored_1',
        expect.objectContaining({
          status: StripeWebhookEventStatus.IGNORED,
          commitmentId: null,
        }),
      );

      // 4. FAILED
      await expect(service.handleWebhook(Buffer.from('{}'), 'sig_4')).rejects.toThrow(
        'DB connection lost',
      );
      expect(updateResultSpy).toHaveBeenNthCalledWith(
        3,
        'evt_test_failed_1',
        expect.objectContaining({
          status: StripeWebhookEventStatus.FAILED,
          errorMessage: expect.stringContaining('DB connection lost'),
        }),
      );
      expect(recordSpy).toHaveBeenCalledTimes(4);
    } finally {
      env.STRIPE_WEBHOOK_SECRET = prevSecret;
    }
  });
});
