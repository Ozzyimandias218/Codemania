import { AttemptStatus, LevelType, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

export class AttemptRepository {
  async create(data: {
    userId: string;
    levelId: string;
    trackId: string;
    type: LevelType;
    questionIds: string[];
    totalQuestions: number;
    heartsRemaining?: number;
  }) {
    return prisma.attempt.create({
      data: {
        userId: data.userId,
        levelId: data.levelId,
        trackId: data.trackId,
        type: data.type,
        questionIds: data.questionIds,
        totalQuestions: data.totalQuestions,
        heartsRemaining: data.heartsRemaining ?? 5,
      },
    });
  }

  async findById(id: string) {
    return prisma.attempt.findUnique({
      where: { id },
      include: {
        level: true,
        answers: true,
      },
    });
  }

  async findSubmission(attemptId: string, questionId: string) {
    return prisma.answerSubmission.findUnique({
      where: { attemptId_questionId: { attemptId, questionId } },
    });
  }

  async hasUserAnsweredQuestion(userId: string, questionId: string): Promise<boolean> {
    const count = await prisma.answerSubmission.count({
      where: { userId, questionId },
    });
    return count > 0;
  }

  async recordAnswerAndUpdateAttempt(
    params: {
      attemptId: string;
      userId: string;
      questionId: string;
      submittedAnswer: string;
      isCorrect: boolean;
      newHearts: number;
      xpDelta: number;
      newStatus: AttemptStatus;
      finishedAt?: Date;
    },
    tx: Prisma.TransactionClient = prisma,
  ) {
    await tx.answerSubmission.create({
      data: {
        attemptId: params.attemptId,
        userId: params.userId,
        questionId: params.questionId,
        submittedAnswer: params.submittedAnswer,
        isCorrect: params.isCorrect,
      },
    });

    return tx.attempt.update({
      where: { id: params.attemptId },
      data: {
        heartsRemaining: params.newHearts,
        answeredCount: { increment: 1 },
        correctCount: { increment: params.isCorrect ? 1 : 0 },
        xpEarned: { increment: params.xpDelta },
        status: params.newStatus,
        ...(params.finishedAt ? { finishedAt: params.finishedAt } : {}),
      },
    });
  }

  async finalizeAttempt(
    params: {
      attemptId: string;
      status: AttemptStatus;
      xpDelta: number;
      finishedAt: Date;
    },
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.attempt.update({
      where: { id: params.attemptId },
      data: {
        status: params.status,
        xpEarned: { increment: params.xpDelta },
        finishedAt: params.finishedAt,
      },
    });
  }
}

export const attemptRepository = new AttemptRepository();
