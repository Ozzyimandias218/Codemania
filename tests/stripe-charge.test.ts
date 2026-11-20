import { CommitmentMode, CommitmentStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commitmentRepository } from '../src/backend/repositories/commitment.repository.ts';
import {
  PENALTY_RETRY_DELAYS_MS,
  StripeGateway,
  StripeService,
  buildCloseChargeIdempotencyKey,
} from '../src/backend/services/stripe.service.ts';
import { jobDispatcher } from '../src/backend/jobs/queues.ts';

function createMockGateway(): StripeGateway {
  return {
    createCustomer: vi.fn().mockResolvedValue({ id: 'cus_123' }),
    createSetupCheckoutSession: vi.fn().mockResolvedValue({ id: 'cs_123', url: 'https://stripe.test/cs_123' }),
    createDepositPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_dep_123', status: 'succeeded' }),
    createOffSessionPenaltyPaymentIntent: vi
      .fn()
      .mockResolvedValue({ id: 'pi_pen_123', status: 'succeeded' }),
    createManualRefund: vi.fn().mockResolvedValue({ id: 're_123', status: 'succeeded' }),
    constructWebhookEvent: vi.fn(),
  };
}

describe('Stripe charge-once rule & appeal freeze', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('never calls Stripe in SIMULATED mode', async () => {
    const gateway = createMockGateway();
    const service = new StripeService(gateway);

    await expect(
      service.createSetupSessionForCommitment({
        userId: 'u1',
        email: 'u1@test.com',
        existingStripeCustomerId: null,
        commitmentId: 'c1',
        mode: CommitmentMode.SIMULATED,
      }),
    ).rejects.toThrow('SIMULATED');

    vi.spyOn(commitmentRepository, 'findById').mockResolvedValue({
      id: 'c-sim',
      mode: CommitmentMode.SIMULATED,
    } as never);

    await expect(service.chargeClosePenaltyOnce('c-sim')).rejects.toThrow('SIMULATED');
    expect(gateway.createOffSessionPenaltyPaymentIntent).not.toHaveBeenCalled();
  });

  it('freezes charging when an appeal is active', async () => {
    const gateway = createMockGateway();
    const service = new StripeService(gateway);

    vi.spyOn(commitmentRepository, 'findById').mockResolvedValue({
      id: 'c-appeal',
      mode: CommitmentMode.PENALTY,
      hasActiveAppeal: true,
      stripePenaltyPaymentIntentId: null,
      maxTotalPenaltyCents: 1000,
      penalties: [{ amountCents: 500, voidedAt: null }],
    } as never);

    await expect(service.chargeClosePenaltyOnce('c-appeal')).rejects.toThrow('frozen');
    expect(gateway.createOffSessionPenaltyPaymentIntent).not.toHaveBeenCalled();
  });

  it('charges at most ONCE at close with commitmentId-derived idempotency key', async () => {
    const gateway = createMockGateway();
    const service = new StripeService(gateway);

    vi.spyOn(commitmentRepository, 'findById')
      .mockResolvedValueOnce({
        id: 'c-1',
        mode: CommitmentMode.PENALTY,
        hasActiveAppeal: false,
        stripePenaltyPaymentIntentId: null,
        stripeCustomerId: 'cus_123',
        stripePaymentMethodId: 'pm_123',
        currency: 'usd',
        maxTotalPenaltyCents: 1000,
        penaltyRetryCount: 0,
        penalties: [
          { amountCents: 300, voidedAt: null },
          { amountCents: 200, voidedAt: null },
        ],
      } as never)
      .mockResolvedValueOnce({
        id: 'c-1',
        mode: CommitmentMode.PENALTY,
        hasActiveAppeal: false,
        stripePenaltyPaymentIntentId: 'pi_pen_123',
        penalties: [{ amountCents: 300, voidedAt: null }],
      } as never);

    const updateSpy = vi.spyOn(commitmentRepository, 'update').mockResolvedValue({} as never);

    const first = await service.chargeClosePenaltyOnce('c-1');
    const second = await service.chargeClosePenaltyOnce('c-1');

    expect(first).toEqual({ charged: true, paymentIntentId: 'pi_pen_123' });
    expect(second).toEqual({
      charged: false,
      paymentIntentId: 'pi_pen_123',
      reason: 'ALREADY_CHARGED',
    });
    expect(gateway.createOffSessionPenaltyPaymentIntent).toHaveBeenCalledTimes(1);
    expect(gateway.createOffSessionPenaltyPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 500,
        idempotencyKey: buildCloseChargeIdempotencyKey('c-1'),
      }),
    );
    expect(updateSpy).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({
        stripePenaltyPaymentIntentId: 'pi_pen_123',
        status: CommitmentStatus.CLOSED,
      }),
    );
  });

  it('retries failed payments 3 times over 7 days and flags for admin after 3 failures', async () => {
    const gateway = createMockGateway();
    const service = new StripeService(gateway);
    const updateSpy = vi.spyOn(commitmentRepository, 'update').mockResolvedValue({} as never);
    const retrySpy = vi.spyOn(jobDispatcher, 'enqueuePenaltyRetry').mockResolvedValue();

    // Retry 1, 2, 3
    await service.handleFailedPenaltyCharge('c-fail', 0);
    await service.handleFailedPenaltyCharge('c-fail', 1);
    await service.handleFailedPenaltyCharge('c-fail', 2);

    expect(retrySpy).toHaveBeenCalledTimes(3);
    expect(PENALTY_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBe(7 * 24 * 60 * 60 * 1000);

    // 4th failure (after 3 retries exhausted) -> flag for admin
    await service.handleFailedPenaltyCharge('c-fail', 3);
    expect(updateSpy).toHaveBeenLastCalledWith(
      'c-fail',
      expect.objectContaining({
        status: CommitmentStatus.PENALTY_DUE,
        needsAdminAttention: true,
      }),
    );
  });
});
