import {
  AristotleTemplateKey,
  DailyQuestionOrigin,
  DailyQuestionStatus,
  DailyQuestionType,
  DailyQuizStatus,
  DisplayNameStatus,
  LeaderboardPeriod,
  Prisma,
} from '@prisma/client';
import { prisma } from '../config/prisma.ts';
import { getIsoWeekKey } from '../utils/dailyQuiz.ts';

export class DailyQuizRepository {
  async findQuizByDate(quizDate: string) {
    return prisma.dailyQuiz.findUnique({
      where: { quizDate },
      include: {
        questions: {
          orderBy: { position: 'asc' },
        },
      },
    });
  }

  async findQuizzesInDateRange(dates: string[]) {
    return prisma.dailyQuiz.findMany({
      where: { quizDate: { in: dates } },
      include: {
        questions: {
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { quizDate: 'asc' },
    });
  }

  async findLiveQuizzesBeforeDate(quizDate: string) {
    return prisma.dailyQuiz.findMany({
      where: {
        status: DailyQuizStatus.LIVE,
        quizDate: { lt: quizDate },
      },
    });
  }

  async createOrGetQuizForDate(
    quizDate: string,
    status: DailyQuizStatus = DailyQuizStatus.BUFFERED,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.dailyQuiz.upsert({
      where: { quizDate },
      create: { quizDate, status },
      update: {},
      include: { questions: { orderBy: { position: 'asc' } } },
    });
  }

  async markQuizLive(quizId: string, usedReserveFallback: boolean, now: Date, tx: Prisma.TransactionClient = prisma) {
    return tx.dailyQuiz.update({
      where: { id: quizId },
      data: {
        status: DailyQuizStatus.LIVE,
        publishedAt: now,
        usedReserveFallback,
      },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
  }

  async markQuizClosed(quizId: string, now: Date, tx: Prisma.TransactionClient = prisma) {
    return tx.dailyQuiz.update({
      where: { id: quizId },
      data: { status: DailyQuizStatus.CLOSED, closedAt: now },
    });
  }

  async findRecentFingerprintMatch(fingerprint: string, sinceDate: Date) {
    return prisma.dailyQuestion.findFirst({
      where: {
        fingerprint,
        createdAt: { gte: sinceDate },
      },
    });
  }

  async findUnusedApprovedReserveQuestions(cutoffDateStr: string, take: number) {
    return prisma.dailyQuestion.findMany({
      where: {
        status: DailyQuestionStatus.APPROVED,
        dailyQuizId: null,
        OR: [{ lastUsedDate: null }, { lastUsedDate: { lte: cutoffDateStr } }],
      },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  async attachQuestionsToQuiz(
    quizId: string,
    quizDate: string,
    questionIds: string[],
    tx: Prisma.TransactionClient = prisma,
  ) {
    for (let i = 0; i < questionIds.length; i++) {
      await tx.dailyQuestion.update({
        where: { id: questionIds[i] },
        data: {
          dailyQuizId: quizId,
          position: i + 1,
          lastUsedDate: quizDate,
          isReserve: false,
        },
      });
    }
  }

  async createQuestion(data: {
    dailyQuizId?: string | null;
    position?: number | null;
    type: DailyQuestionType;
    prompt: string;
    codeSnippet?: string | null;
    spokenText?: string | null;
    options?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
    correctAnswer: string;
    numericAnswer?: number | null;
    scale?: number | null;
    explanation: string;
    sourceUrl?: string | null;
    license?: string | null;
    status: DailyQuestionStatus;
    generatedBy: DailyQuestionOrigin;
    fingerprint: string;
    isReserve?: boolean;
    createdById?: string | null;
  }) {
    return prisma.dailyQuestion.create({ data });
  }

  async findQuestionById(id: string) {
    return prisma.dailyQuestion.findUnique({ where: { id } });
  }

  async listQuestions(filters: {
    status?: DailyQuestionStatus;
    isReserve?: boolean;
    dailyQuizId?: string;
  }) {
    return prisma.dailyQuestion.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.isReserve !== undefined ? { isReserve: filters.isReserve } : {}),
        ...(filters.dailyQuizId ? { dailyQuizId: filters.dailyQuizId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateQuestionReview(
    id: string,
    data: {
      status: DailyQuestionStatus;
      rejectionReason: string | null;
      reviewedById: string;
      reviewedAt: Date;
    },
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.dailyQuestion.update({ where: { id }, data });
  }

  async findAttempt(userId: string, quizDate: string) {
    return prisma.dailyAttempt.findUnique({
      where: { userId_quizDate: { userId, quizDate } },
      include: {
        answers: { orderBy: { position: 'asc' } },
        dailyQuiz: {
          include: { questions: { orderBy: { position: 'asc' } } },
        },
      },
    });
  }

  async createAttempt(data: {
    userId: string;
    dailyQuizId: string;
    quizDate: string;
    now: Date;
  }) {
    return prisma.dailyAttempt.create({
      data: {
        userId: data.userId,
        dailyQuizId: data.dailyQuizId,
        quizDate: data.quizDate,
        startedAt: data.now,
        currentPosition: 1,
        currentQuestionStartedAt: data.now,
      },
      include: {
        answers: true,
        dailyQuiz: {
          include: { questions: { orderBy: { position: 'asc' } } },
        },
      },
    });
  }

  async recordAnswerAndAdvance(
    params: {
      attemptId: string;
      userId: string;
      quizDate: string;
      questionId: string;
      position: number;
      givenValue: string | null;
      score: number;
      timeMs: number;
      isLate: boolean;
      isFinalQuestion: boolean;
      now: Date;
      country: string | null;
    },
    tx: Prisma.TransactionClient = prisma,
  ) {
    const answer = await tx.dailyAnswer.create({
      data: {
        attemptId: params.attemptId,
        questionId: params.questionId,
        position: params.position,
        givenValue: params.givenValue,
        score: params.score,
        timeMs: params.timeMs,
        isLate: params.isLate,
        submittedAt: params.now,
      },
    });

    const attempt = await tx.dailyAttempt.update({
      where: { id: params.attemptId },
      data: {
        totalScore: { increment: params.score },
        totalTimeMs: { increment: params.timeMs },
        ...(params.isFinalQuestion
          ? { finishedAt: params.now }
          : {
              currentPosition: params.position + 1,
              currentQuestionStartedAt: params.now,
            }),
      },
    });

    if (params.isFinalQuestion) {
      await this.upsertLeaderboardEntriesForCompletedAttempt(
        {
          userId: params.userId,
          quizDate: params.quizDate,
          score: attempt.totalScore,
          timeMs: attempt.totalTimeMs,
          country: params.country,
        },
        tx,
      );
    }

    return { answer, attempt };
  }

  async upsertLeaderboardEntriesForCompletedAttempt(
    params: {
      userId: string;
      quizDate: string;
      score: number;
      timeMs: number;
      country: string | null;
    },
    tx: Prisma.TransactionClient = prisma,
  ) {
    const weekKey = getIsoWeekKey(params.quizDate);

    // DAILY: exact score/timeMs for that quizDate
    await tx.leaderboardEntry.upsert({
      where: {
        userId_period_periodKey: {
          userId: params.userId,
          period: LeaderboardPeriod.DAILY,
          periodKey: params.quizDate,
        },
      },
      create: {
        userId: params.userId,
        period: LeaderboardPeriod.DAILY,
        periodKey: params.quizDate,
        score: params.score,
        timeMs: params.timeMs,
        country: params.country,
      },
      update: {
        score: params.score,
        timeMs: params.timeMs,
        country: params.country,
      },
    });

    // WEEKLY & ALL_TIME accumulate totalScore & totalTimeMs across completed attempts
    for (const [period, periodKey] of [
      [LeaderboardPeriod.WEEKLY, weekKey],
      [LeaderboardPeriod.ALL_TIME, 'ALL'],
    ] as const) {
      await tx.leaderboardEntry.upsert({
        where: {
          userId_period_periodKey: {
            userId: params.userId,
            period,
            periodKey,
          },
        },
        create: {
          userId: params.userId,
          period,
          periodKey,
          score: params.score,
          timeMs: params.timeMs,
          country: params.country,
        },
        update: {
          score: { increment: params.score },
          timeMs: { increment: params.timeMs },
          country: params.country,
        },
      });
    }
  }

  async finalizeLeaderboardForDate(quizDate: string, tx: Prisma.TransactionClient = prisma) {
    const attempts = await tx.dailyAttempt.findMany({
      where: { quizDate, finishedAt: { not: null } },
      include: { user: { select: { country: true } } },
    });

    for (const att of attempts) {
      await tx.leaderboardEntry.upsert({
        where: {
          userId_period_periodKey: {
            userId: att.userId,
            period: LeaderboardPeriod.DAILY,
            periodKey: quizDate,
          },
        },
        create: {
          userId: att.userId,
          period: LeaderboardPeriod.DAILY,
          periodKey: quizDate,
          score: att.totalScore,
          timeMs: att.totalTimeMs,
          country: att.user.country,
        },
        update: {
          score: att.totalScore,
          timeMs: att.totalTimeMs,
          country: att.user.country,
        },
      });
    }
  }

  async listLeaderboardEligible(params: {
    period: LeaderboardPeriod;
    periodKey: string;
    limit: number;
    cursor?: { score: number; timeMs: number; userId: string } | null;
  }) {
    const whereCursor: Prisma.LeaderboardEntryWhereInput = params.cursor
      ? {
          OR: [
            { score: { lt: params.cursor.score } },
            {
              AND: [
                { score: params.cursor.score },
                { timeMs: { gt: params.cursor.timeMs } },
              ],
            },
            {
              AND: [
                { score: params.cursor.score },
                { timeMs: params.cursor.timeMs },
                { userId: { gt: params.cursor.userId } },
              ],
            },
          ],
        }
      : {};

    return prisma.leaderboardEntry.findMany({
      where: {
        period: params.period,
        periodKey: params.periodKey,
        user: {
          displayName: { not: null },
          displayNameStatus: DisplayNameStatus.APPROVED,
        },
        ...whereCursor,
      },
      include: {
        user: { select: { id: true, displayName: true, country: true } },
      },
      orderBy: [{ score: 'desc' }, { timeMs: 'asc' }, { userId: 'asc' }],
      take: params.limit + 1,
    });
  }

  async findAllLeaderboardForRank(period: LeaderboardPeriod, periodKey: string) {
    return prisma.leaderboardEntry.findMany({
      where: {
        period,
        periodKey,
        user: {
          displayName: { not: null },
          displayNameStatus: DisplayNameStatus.APPROVED,
        },
      },
      include: {
        user: { select: { id: true, displayName: true, country: true } },
      },
      orderBy: [{ score: 'desc' }, { timeMs: 'asc' }, { userId: 'asc' }],
    });
  }

  async listAristotleTemplates() {
    return prisma.aristotleTemplate.findMany({ orderBy: { key: 'asc' } });
  }

  async getAristotleTemplate(key: AristotleTemplateKey) {
    return prisma.aristotleTemplate.findUnique({ where: { key } });
  }

  async upsertAristotleTemplate(data: {
    key: AristotleTemplateKey;
    title: string;
    body: string;
    language: string;
    voiceId: string;
    updatedById: string;
  }) {
    return prisma.aristotleTemplate.upsert({
      where: { key: data.key },
      create: data,
      update: {
        title: data.title,
        body: data.body,
        language: data.language,
        voiceId: data.voiceId,
        updatedById: data.updatedById,
      },
    });
  }

  async findOpenAlert(type: string, quizDate?: string) {
    return prisma.adminAlert.findFirst({
      where: {
        type,
        quizDate: quizDate ?? null,
        resolvedAt: null,
      },
    });
  }

  async createAdminAlert(data: { type: string; message: string; quizDate?: string }) {
    return prisma.adminAlert.create({
      data: {
        type: data.type,
        message: data.message,
        quizDate: data.quizDate ?? null,
      },
    });
  }

  async listOpenAlerts() {
    return prisma.adminAlert.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolveAlert(id: string) {
    return prisma.adminAlert.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
  }

  async updateUserProfile(
    userId: string,
    data: {
      displayName?: string | null;
      displayNameStatus?: DisplayNameStatus;
      country?: string | null;
    },
  ) {
    return prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        displayName: true,
        displayNameStatus: true,
        country: true,
      },
    });
  }
}

export const dailyQuizRepository = new DailyQuizRepository();
