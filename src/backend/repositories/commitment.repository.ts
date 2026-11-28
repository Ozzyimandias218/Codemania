import {
  AppealStatus,
  CommitmentMode,
  CommitmentStatus,
  FinalSubmissionStatus,
  FinalSubmissionType,
  MissedDayMode,
  PenaltyType,
  Prisma,
  StripeWebhookEventStatus,
} from '@prisma/client';
import { prisma } from '../config/prisma.ts';
import {
  StripeWebhookEventRecord,
  StripeWebhookListFilters,
  StripeWebhookStatusCounts,
  isWebhookSandboxMode,
  sandboxWebhookStore,
} from '../services/webhookLogStore.ts';

export class CommitmentRepository {
  async create(data: {
    userId: string;
    trackId: string;
    startDate: Date;
    durationDays: number;
    timezone: string;
    mode: CommitmentMode;
    missedDayMode: MissedDayMode;
    dailyPenaltyCents: number;
    finalFailPenaltyCents: number;
    depositCents?: number | null;
    maxTotalPenaltyCents: number;
    excusedDaysAllowed: number;
    currency: string;
    status: CommitmentStatus;
    termsVersion: string;
    termsAcceptedAt: Date;
    requiredLevelsPerDay: number;
    stripeCustomerId?: string | null;
  }) {
    return prisma.commitment.create({ data });
  }

  async findById(id: string) {
    return prisma.commitment.findUnique({
      where: { id },
      include: {
        track: true,
        user: { select: { id: true, email: true, stripeCustomerId: true, timezone: true } },
        penalties: { orderBy: { createdAt: 'asc' } },
        finalSubmissions: { orderBy: { createdAt: 'asc' } },
        appeals: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async findByUser(userId: string) {
    return prisma.commitment.findMany({
      where: { userId },
      include: {
        track: { select: { id: true, slug: true, title: true } },
        penalties: true,
        finalSubmissions: true,
        appeals: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveOrDueCommitments() {
    return prisma.commitment.findMany({
      where: {
        status: { in: [CommitmentStatus.ACTIVE, CommitmentStatus.PENALTY_DUE] },
      },
      include: {
        penalties: true,
        finalSubmissions: true,
        appeals: true,
      },
    });
  }

  async findByCheckoutSessionId(sessionId: string) {
    return prisma.commitment.findFirst({
      where: { stripeCheckoutSessionId: sessionId },
    });
  }

  async findBySetupIntentId(setupIntentId: string) {
    return prisma.commitment.findFirst({
      where: { stripeSetupIntentId: setupIntentId },
    });
  }

  async findByPaymentIntentId(paymentIntentId: string) {
    return prisma.commitment.findFirst({
      where: {
        OR: [
          { stripePenaltyPaymentIntentId: paymentIntentId },
          { stripeDepositPaymentIntentId: paymentIntentId },
        ],
      },
    });
  }

  async update(id: string, data: Prisma.CommitmentUpdateInput, tx: Prisma.TransactionClient = prisma) {
    return tx.commitment.update({ where: { id }, data });
  }

  async createPenaltyIdempotent(
    data: {
      commitmentId: string;
      type: PenaltyType;
      date: string;
      amountCents: number;
    },
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{ created: boolean }> {
    const existing = await tx.commitmentPenalty.findUnique({
      where: {
        commitmentId_type_date: {
          commitmentId: data.commitmentId,
          type: data.type,
          date: data.date,
        },
      },
    });
    if (existing) return { created: false };
    try {
      await tx.commitmentPenalty.create({ data });
      return { created: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { created: false };
      }
      throw err;
    }
  }

  async findPenaltyById(id: string) {
    return prisma.commitmentPenalty.findUnique({ where: { id } });
  }

  async voidPenalty(id: string, voidedById: string, voidReason: string) {
    return prisma.commitmentPenalty.update({
      where: { id },
      data: {
        voidedAt: new Date(),
        voidedById,
        voidReason,
      },
    });
  }

  async countExamAttempts(commitmentId: string): Promise<number> {
    return prisma.finalSubmission.count({
      where: { commitmentId, type: FinalSubmissionType.EXAM },
    });
  }

  async createFinalSubmission(data: {
    commitmentId: string;
    userId: string;
    type: FinalSubmissionType;
    status: FinalSubmissionStatus;
    attemptNumber: number;
    questionIds?: Prisma.InputJsonValue;
    answers?: Prisma.InputJsonValue;
    scorePct?: number;
    startedAt?: Date;
    expiresAt?: Date;
    submittedAt?: Date;
    projectUrl?: string;
    projectNotes?: string;
  }) {
    return prisma.finalSubmission.create({ data });
  }

  async findFinalSubmissionById(id: string) {
    return prisma.finalSubmission.findUnique({
      where: { id },
      include: { commitment: true, appeals: true },
    });
  }

  async listFinalSubmissions(status?: FinalSubmissionStatus) {
    return prisma.finalSubmission.findMany({
      where: status ? { status } : {},
      include: {
        commitment: { select: { id: true, userId: true, trackId: true, status: true, mode: true } },
        user: { select: { id: true, email: true, name: true } },
        appeals: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateFinalSubmission(
    id: string,
    data: Prisma.FinalSubmissionUpdateInput,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.finalSubmission.update({ where: { id }, data });
  }

  async createAppeal(data: {
    commitmentId: string;
    userId: string;
    finalSubmissionId?: string;
    reason: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const appeal = await tx.appeal.create({
        data: {
          commitmentId: data.commitmentId,
          userId: data.userId,
          finalSubmissionId: data.finalSubmissionId ?? null,
          reason: data.reason,
        },
      });
      await tx.commitment.update({
        where: { id: data.commitmentId },
        data: { hasActiveAppeal: true },
      });
      return appeal;
    });
  }

  async countPendingAppeals(commitmentId: string, tx: Prisma.TransactionClient = prisma) {
    return tx.appeal.count({
      where: { commitmentId, status: AppealStatus.PENDING },
    });
  }

  async resolveAppeal(
    appealId: string,
    data: {
      status: AppealStatus;
      adminDecisionNotes: string;
      decidedById: string;
    },
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.appeal.update({
      where: { id: appealId },
      data: {
        status: data.status,
        adminDecisionNotes: data.adminDecisionNotes,
        decidedById: data.decidedById,
        decidedAt: new Date(),
      },
    });
  }

  async recordWebhookEventIfNew(eventId: string, type: string): Promise<boolean> {
    if (isWebhookSandboxMode()) {
      return sandboxWebhookStore.recordIfNew(eventId, type);
    }
    try {
      await prisma.stripeWebhookEvent.create({
        data: {
          id: eventId,
          type,
          status: StripeWebhookEventStatus.PROCESSING,
          processedAt: null,
        },
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false;
      }
      throw err;
    }
  }

  async markWebhookEventDuplicate(eventId: string): Promise<void> {
    if (isWebhookSandboxMode()) {
      sandboxWebhookStore.markDuplicate(eventId);
      return;
    }
    await prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: {
        duplicateCount: { increment: 1 },
        lastDuplicateAt: new Date(),
      },
    });
  }

  async updateWebhookEventResult(
    eventId: string,
    data: {
      status: StripeWebhookEventStatus;
      commitmentId?: string | null;
      summary?: string | null;
      errorMessage?: string | null;
      processedAt?: Date;
    },
  ): Promise<void> {
    if (isWebhookSandboxMode()) {
      sandboxWebhookStore.updateResult(eventId, data);
      return;
    }
    await prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: {
        status: data.status,
        commitmentId: data.commitmentId ?? null,
        summary: data.summary ?? null,
        errorMessage: data.errorMessage ?? null,
        processedAt: data.processedAt ?? new Date(),
      },
    });
  }

  async listWebhookEvents(filters: StripeWebhookListFilters): Promise<{
    events: StripeWebhookEventRecord[];
    counts: StripeWebhookStatusCounts;
    source: 'postgresql' | 'sandbox-memory';
  }> {
    if (isWebhookSandboxMode()) {
      return {
        ...sandboxWebhookStore.list(filters),
        source: 'sandbox-memory',
      };
    }

    const where: Prisma.StripeWebhookEventWhereInput = {};
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.type?.trim()) {
      where.type = { equals: filters.type.trim(), mode: 'insensitive' };
    }
    if (filters.search?.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { type: { contains: q, mode: 'insensitive' } },
        { commitmentId: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { errorMessage: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [events, grouped] = await Promise.all([
      prisma.stripeWebhookEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: filters.limit,
      }),
      prisma.stripeWebhookEvent.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const counts: StripeWebhookStatusCounts = {
      total: 0,
      processed: 0,
      failed: 0,
      ignored: 0,
      processing: 0,
    };
    for (const row of grouped) {
      const count = row._count._all;
      counts.total += count;
      if (row.status === StripeWebhookEventStatus.PROCESSED) counts.processed = count;
      else if (row.status === StripeWebhookEventStatus.FAILED) counts.failed = count;
      else if (row.status === StripeWebhookEventStatus.IGNORED) counts.ignored = count;
      else if (row.status === StripeWebhookEventStatus.PROCESSING) counts.processing = count;
    }

    return {
      events,
      counts,
      source: 'postgresql',
    };
  }
}

export const commitmentRepository = new CommitmentRepository();
