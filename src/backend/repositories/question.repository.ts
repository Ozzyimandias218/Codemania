import { Prisma, QuestionOrigin, QuestionStatus, QuestionType } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

export class QuestionRepository {
  async findById(id: string) {
    return prisma.question.findUnique({
      where: { id },
      include: { level: { include: { unit: true, track: true } } },
    });
  }

  async findManyByIds(ids: string[]) {
    return prisma.question.findMany({
      where: { id: { in: ids } },
    });
  }

  async findApprovedByLevel(levelId: string) {
    return prisma.question.findMany({
      where: {
        levelId,
        status: QuestionStatus.APPROVED,
        isLatest: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findApprovedEarlierInTrack(params: {
    trackId: string;
    beforeLevelNumber: number;
    origin?: QuestionOrigin;
  }) {
    return prisma.question.findMany({
      where: {
        status: QuestionStatus.APPROVED,
        isLatest: true,
        ...(params.origin ? { origin: params.origin } : {}),
        level: {
          trackId: params.trackId,
          number: { lt: params.beforeLevelNumber },
          type: 'LESSON',
        },
      },
      include: {
        level: {
          select: { id: true, number: true, unitId: true, type: true },
        },
      },
    });
  }

  async findApprovedInTrackUnitsUpTo(trackId: string, maxUnitOrder: number) {
    return prisma.question.findMany({
      where: {
        status: QuestionStatus.APPROVED,
        isLatest: true,
        origin: QuestionOrigin.AUTHORED,
        level: {
          trackId,
          type: 'LESSON',
          unit: {
            order: { lt: maxUnitOrder },
          },
        },
      },
      include: {
        level: { include: { unit: true } },
      },
    });
  }

  async findApprovedByTrackForFinalExam(trackId: string) {
    return prisma.question.findMany({
      where: {
        status: QuestionStatus.APPROVED,
        isLatest: true,
        level: { trackId },
      },
    });
  }

  async listForAdmin(filters: {
    status?: QuestionStatus;
    origin?: QuestionOrigin;
    levelId?: string;
    isLatest?: boolean;
  }) {
    return prisma.question.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.origin ? { origin: filters.origin } : {}),
        ...(filters.levelId ? { levelId: filters.levelId } : {}),
        ...(filters.isLatest !== undefined ? { isLatest: filters.isLatest } : {}),
      },
      include: {
        level: { include: { unit: true, track: { select: { id: true, slug: true, title: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: {
    levelId: string;
    questionGroupId: string;
    type: QuestionType;
    prompt: string;
    codeSnippet?: string | null;
    spokenText?: string | null;
    options?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    answer: string;
    explanation: string;
    origin: QuestionOrigin;
    sourceUrl?: string | null;
    license?: string | null;
    status: QuestionStatus;
    version?: number;
    isLatest?: boolean;
    createdById?: string | null;
    reviewedById?: string | null;
    reviewedAt?: Date | null;
  }) {
    return prisma.question.create({ data });
  }

  async updateReviewStatus(
    id: string,
    data: {
      status: QuestionStatus;
      rejectionReason: string | null;
      reviewedById: string;
      reviewedAt: Date;
    },
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.question.update({
      where: { id },
      data,
    });
  }

  async markSuperseded(id: string, tx: Prisma.TransactionClient = prisma) {
    return tx.question.update({
      where: { id },
      data: { isLatest: false },
    });
  }
}

export const questionRepository = new QuestionRepository();
