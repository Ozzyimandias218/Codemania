import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

export class ReviewQueueRepository {
  async findByUser(userId: string) {
    return prisma.reviewQueueItem.findMany({
      where: { userId },
      include: {
        question: {
          select: {
            id: true,
            levelId: true,
            type: true,
            prompt: true,
            status: true,
          },
        },
      },
      orderBy: { nextReviewAt: 'asc' },
    });
  }

  async findDueByUserAndTrack(userId: string, trackId: string, now: Date) {
    return prisma.reviewQueueItem.findMany({
      where: {
        userId,
        nextReviewAt: { lte: now },
        question: {
          status: 'APPROVED',
          isLatest: true,
          level: { trackId },
        },
      },
      include: {
        question: true,
      },
      orderBy: { nextReviewAt: 'asc' },
    });
  }

  async findAllQuestionIdsInUserQueue(userId: string): Promise<Set<string>> {
    const rows = await prisma.reviewQueueItem.findMany({
      where: { userId },
      select: { questionId: true },
    });
    return new Set(rows.map((r) => r.questionId));
  }

  async findByUserAndQuestion(
    userId: string,
    questionId: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.reviewQueueItem.findUnique({
      where: { userId_questionId: { userId, questionId } },
    });
  }

  async upsertWrong(
    params: { userId: string; questionId: string; nextReviewAt: Date; now: Date },
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.reviewQueueItem.upsert({
      where: { userId_questionId: { userId: params.userId, questionId: params.questionId } },
      create: {
        userId: params.userId,
        questionId: params.questionId,
        wrongCount: 1,
        consecutiveCorrect: 0,
        intervalStage: 0,
        nextReviewAt: params.nextReviewAt,
        lastReviewedAt: params.now,
      },
      update: {
        wrongCount: { increment: 1 },
        consecutiveCorrect: 0,
        intervalStage: 0,
        nextReviewAt: params.nextReviewAt,
        lastReviewedAt: params.now,
      },
    });
  }

  async updateProgress(
    id: string,
    data: {
      consecutiveCorrect: number;
      intervalStage: number;
      nextReviewAt: Date;
      lastReviewedAt: Date;
    },
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.reviewQueueItem.update({
      where: { id },
      data,
    });
  }

  async deleteById(id: string, tx: Prisma.TransactionClient = prisma) {
    return tx.reviewQueueItem.delete({ where: { id } });
  }
}

export const reviewQueueRepository = new ReviewQueueRepository();
