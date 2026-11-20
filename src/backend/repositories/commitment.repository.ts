import {
  AppealStatus,
  CommitmentMode,
  CommitmentStatus,
  FinalSubmissionStatus,
  FinalSubmissionType,
  MissedDayMode,
  PenaltyType,
  Prisma,
} from '@prisma/client';
import { prisma } from '../config/prisma.ts';

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
    try {
      await prisma.stripeWebhookEvent.create({ data: { id: eventId, type } });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false;
      }
      throw err;
    }
  }
}

export const commitmentRepository = new CommitmentRepository();
