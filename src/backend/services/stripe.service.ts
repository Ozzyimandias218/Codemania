import { CommitmentMode, CommitmentStatus } from '@prisma/client';
import Stripe from 'stripe';
import { env } from '../config/env.ts';
import { jobDispatcher } from '../jobs/queues.ts';
import { commitmentRepository } from '../repositories/commitment.repository.ts';
import { userRepository } from '../repositories/user.repository.ts';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.ts';

export const PENALTY_RETRY_DELAYS_MS = [
  2 * 24 * 60 * 60 * 1000, // Retry 1: +2 days
  2 * 24 * 60 * 60 * 1000, // Retry 2: +4 days total
  3 * 24 * 60 * 60 * 1000, // Retry 3: +7 days total
] as const;

export function buildCloseChargeIdempotencyKey(commitmentId: string): string {
  return `codemania-commitment-close-${commitmentId}`;
}

export interface StripeGateway {
  createCustomer(params: { email: string; userId: string }): Promise<{ id: string }>;
  createSetupCheckoutSession(params: {
    customerId: string;
    commitmentId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ id: string; url: string | null }>;
  createDepositPaymentIntent(params: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    currency: string;
    commitmentId: string;
  }): Promise<{ id: string; status: string }>;
  createOffSessionPenaltyPaymentIntent(params: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    currency: string;
    commitmentId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; status: string }>;
  createManualRefund(params: {
    paymentIntentId: string;
    amountCents?: number;
  }): Promise<{ id: string; status: string | null }>;
  constructWebhookEvent(rawBody: Buffer, signature: string, webhookSecret: string): Stripe.Event;
}

class RealStripeGateway implements StripeGateway {
  private client: Stripe | null = null;

  private getClient(): Stripe {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    if (!this.client) {
      this.client = new Stripe(env.STRIPE_SECRET_KEY);
    }
    return this.client;
  }

  async createCustomer(params: { email: string; userId: string }) {
    const customer = await this.getClient().customers.create({
      email: params.email,
      metadata: { userId: params.userId },
    });
    return { id: customer.id };
  }

  async createSetupCheckoutSession(params: {
    customerId: string;
    commitmentId: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    const session = await this.getClient().checkout.sessions.create({
      mode: 'setup',
      customer: params.customerId,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: { commitmentId: params.commitmentId },
      setup_intent_data: {
        metadata: { commitmentId: params.commitmentId },
      },
    });
    return { id: session.id, url: session.url };
  }

  async createDepositPaymentIntent(params: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    currency: string;
    commitmentId: string;
  }) {
    const pi = await this.getClient().paymentIntents.create(
      {
        amount: params.amountCents,
        currency: params.currency,
        customer: params.customerId,
        payment_method: params.paymentMethodId,
        confirm: true,
        off_session: true,
        metadata: { commitmentId: params.commitmentId, purpose: 'deposit' },
      },
      { idempotencyKey: `codemania-deposit-${params.commitmentId}` },
    );
    return { id: pi.id, status: pi.status };
  }

  async createOffSessionPenaltyPaymentIntent(params: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    currency: string;
    commitmentId: string;
    idempotencyKey: string;
  }) {
    const pi = await this.getClient().paymentIntents.create(
      {
        amount: params.amountCents,
        currency: params.currency,
        customer: params.customerId,
        payment_method: params.paymentMethodId,
        confirm: true,
        off_session: true,
        metadata: { commitmentId: params.commitmentId, purpose: 'penalty_close' },
      },
      { idempotencyKey: params.idempotencyKey },
    );
    return { id: pi.id, status: pi.status };
  }

  async createManualRefund(params: { paymentIntentId: string; amountCents?: number }) {
    const refund = await this.getClient().refunds.create({
      payment_intent: params.paymentIntentId,
      ...(params.amountCents !== undefined ? { amount: params.amountCents } : {}),
    });
    return { id: refund.id, status: refund.status };
  }

  constructWebhookEvent(rawBody: Buffer, signature: string, webhookSecret: string): Stripe.Event {
    return this.getClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
  }
}

export class StripeService {
  constructor(private readonly gateway: StripeGateway = new RealStripeGateway()) {}

  async createSetupSessionForCommitment(params: {
    userId: string;
    email: string;
    existingStripeCustomerId: string | null;
    commitmentId: string;
    mode: CommitmentMode;
  }): Promise<{ stripeCustomerId: string; checkoutSessionId: string; checkoutUrl: string | null }> {
    if (params.mode === CommitmentMode.SIMULATED) {
      throw new BadRequestError('Stripe must never be called in SIMULATED mode');
    }

    let customerId = params.existingStripeCustomerId;
    if (!customerId) {
      const customer = await this.gateway.createCustomer({
        email: params.email,
        userId: params.userId,
      });
      customerId = customer.id;
      await userRepository.updateStripeCustomerId(params.userId, customerId);
    }

    const session = await this.gateway.createSetupCheckoutSession({
      customerId,
      commitmentId: params.commitmentId,
      successUrl: env.STRIPE_SUCCESS_URL,
      cancelUrl: env.STRIPE_CANCEL_URL,
    });

    await commitmentRepository.update(params.commitmentId, {
      stripeCustomerId: customerId,
      stripeCheckoutSessionId: session.id,
    });

    return {
      stripeCustomerId: customerId,
      checkoutSessionId: session.id,
      checkoutUrl: session.url,
    };
  }

  /**
   * Charge-once rule (Section 7):
   * - Never called in SIMULATED mode.
   * - Blocked if commitment has an active appeal.
   * - Never creates more than ONE close-out PaymentIntent per commitmentId.
   */
  async chargeClosePenaltyOnce(commitmentId: string): Promise<{
    charged: boolean;
    paymentIntentId?: string;
    reason?: string;
  }> {
    const commitment = await commitmentRepository.findById(commitmentId);
    if (!commitment) {
      throw new NotFoundError('Commitment not found');
    }

    if (commitment.mode === CommitmentMode.SIMULATED) {
      throw new BadRequestError('Stripe must never be called in SIMULATED mode');
    }

    if (commitment.hasActiveAppeal) {
      throw new ConflictError(
        'Charging is frozen while an appeal is pending admin decision',
        'APPEAL_FROZEN',
      );
    }

    if (commitment.mode !== CommitmentMode.PENALTY) {
      return { charged: false, reason: 'MODE_DOES_NOT_AUTO_CHARGE_AT_CLOSE' };
    }

    if (commitment.stripePenaltyPaymentIntentId) {
      return {
        charged: false,
        paymentIntentId: commitment.stripePenaltyPaymentIntentId,
        reason: 'ALREADY_CHARGED',
      };
    }

    const totalPenaltyCents = Math.min(
      commitment.maxTotalPenaltyCents,
      commitment.penalties
        .filter((p) => p.voidedAt === null)
        .reduce((sum, p) => sum + p.amountCents, 0),
    );

    if (totalPenaltyCents <= 0) {
      await commitmentRepository.update(commitment.id, {
        status: CommitmentStatus.CLOSED,
        closedAt: new Date(),
      });
      return { charged: false, reason: 'ZERO_PENALTY' };
    }

    if (!commitment.stripeCustomerId || !commitment.stripePaymentMethodId) {
      await commitmentRepository.update(commitment.id, {
        status: CommitmentStatus.PENALTY_DUE,
        needsAdminAttention: true,
      });
      return { charged: false, reason: 'MISSING_PAYMENT_METHOD' };
    }

    const idempotencyKey = buildCloseChargeIdempotencyKey(commitment.id);
    try {
      const pi = await this.gateway.createOffSessionPenaltyPaymentIntent({
        customerId: commitment.stripeCustomerId,
        paymentMethodId: commitment.stripePaymentMethodId,
        amountCents: totalPenaltyCents,
        currency: commitment.currency,
        commitmentId: commitment.id,
        idempotencyKey,
      });

      await commitmentRepository.update(commitment.id, {
        stripePenaltyPaymentIntentId: pi.id,
        lastPenaltyAttemptAt: new Date(),
        ...(pi.status === 'succeeded'
          ? { status: CommitmentStatus.CLOSED, closedAt: new Date() }
          : { status: CommitmentStatus.PENALTY_DUE }),
      });

      return { charged: true, paymentIntentId: pi.id };
    } catch {
      await this.handleFailedPenaltyCharge(commitment.id, commitment.penaltyRetryCount);
      return { charged: false, reason: 'PAYMENT_FAILED_SCHEDULED_RETRY' };
    }
  }

  async handleFailedPenaltyCharge(commitmentId: string, currentRetryCount: number): Promise<void> {
    const nextRetryCount = currentRetryCount + 1;
    if (nextRetryCount <= PENALTY_RETRY_DELAYS_MS.length) {
      await commitmentRepository.update(commitmentId, {
        status: CommitmentStatus.PENALTY_DUE,
        penaltyRetryCount: nextRetryCount,
        lastPenaltyAttemptAt: new Date(),
      });
      const delayMs = PENALTY_RETRY_DELAYS_MS[nextRetryCount - 1];
      await jobDispatcher.enqueuePenaltyRetry(
        { commitmentId, attemptNumber: nextRetryCount },
        delayMs,
      );
    } else {
      await commitmentRepository.update(commitmentId, {
        status: CommitmentStatus.PENALTY_DUE,
        needsAdminAttention: true,
        lastPenaltyAttemptAt: new Date(),
      });
    }
  }

  async manualRefundDeposit(commitmentId: string, amountCents?: number) {
    const commitment = await commitmentRepository.findById(commitmentId);
    if (!commitment) {
      throw new NotFoundError('Commitment not found');
    }
    if (commitment.mode !== CommitmentMode.DEPOSIT_REFUND) {
      throw new BadRequestError('Commitment is not in DEPOSIT_REFUND mode');
    }
    if (!commitment.stripeDepositPaymentIntentId) {
      throw new BadRequestError('No deposit PaymentIntent recorded for this commitment');
    }
    return this.gateway.createManualRefund({
      paymentIntentId: commitment.stripeDepositPaymentIntentId,
      amountCents,
    });
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new ForbiddenError('Stripe webhook secret is not configured');
    }
    if (!signature) {
      throw new BadRequestError('Missing stripe-signature header');
    }

    const event = this.gateway.constructWebhookEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );

    const isNew = await commitmentRepository.recordWebhookEventIfNew(event.id, event.type);
    if (!isNew) {
      return { received: true, duplicate: true };
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const commitment = await commitmentRepository.findByCheckoutSessionId(session.id);
        if (commitment && commitment.mode !== CommitmentMode.SIMULATED) {
          const setupIntentId =
            typeof session.setup_intent === 'string'
              ? session.setup_intent
              : session.setup_intent?.id ?? null;

          await commitmentRepository.update(commitment.id, {
            stripeSetupIntentId: setupIntentId,
            status: CommitmentStatus.ACTIVE,
          });
        }
        break;
      }

      case 'setup_intent.succeeded': {
        const si = event.data.object as Stripe.SetupIntent;
        const paymentMethodId =
          typeof si.payment_method === 'string'
            ? si.payment_method
            : si.payment_method?.id ?? null;
        const commitmentId = si.metadata?.commitmentId;
        const commitment = commitmentId
          ? await commitmentRepository.findById(commitmentId)
          : await commitmentRepository.findBySetupIntentId(si.id);
        if (commitment && paymentMethodId && commitment.mode !== CommitmentMode.SIMULATED) {
          await commitmentRepository.update(commitment.id, {
            stripeSetupIntentId: si.id,
            stripePaymentMethodId: paymentMethodId,
            status:
              commitment.status === CommitmentStatus.PENDING_PAYMENT_METHOD
                ? CommitmentStatus.ACTIVE
                : commitment.status,
          });

          if (
            commitment.mode === CommitmentMode.DEPOSIT_REFUND &&
            commitment.depositCents &&
            commitment.depositCents > 0 &&
            !commitment.stripeDepositPaymentIntentId &&
            commitment.stripeCustomerId
          ) {
            const depositPi = await this.gateway.createDepositPaymentIntent({
              customerId: commitment.stripeCustomerId,
              paymentMethodId,
              amountCents: commitment.depositCents,
              currency: commitment.currency,
              commitmentId: commitment.id,
            });
            await commitmentRepository.update(commitment.id, {
              stripeDepositPaymentIntentId: depositPi.id,
            });
          }
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const commitment = await commitmentRepository.findByPaymentIntentId(pi.id);
        if (commitment && commitment.stripePenaltyPaymentIntentId === pi.id) {
          await commitmentRepository.update(commitment.id, {
            status: CommitmentStatus.CLOSED,
            closedAt: new Date(),
            needsAdminAttention: false,
          });
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const commitment = await commitmentRepository.findByPaymentIntentId(pi.id);
        if (commitment && commitment.stripePenaltyPaymentIntentId === pi.id) {
          await this.handleFailedPenaltyCharge(commitment.id, commitment.penaltyRetryCount);
        }
        break;
      }

      default:
        break;
    }

    return { received: true, duplicate: false };
  }
}

export const stripeService = new StripeService();
