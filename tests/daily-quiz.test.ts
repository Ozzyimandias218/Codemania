import {
  AristotleTemplateKey,
  DailyQuestion,
  DailyQuestionOrigin,
  DailyQuestionStatus,
  DailyQuestionType,
  DailyQuizStatus,
  DisplayNameStatus,
  LeaderboardPeriod,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/backend/config/env.ts';
import { prisma } from '../src/backend/config/prisma.ts';
import { auditLogRepository } from '../src/backend/repositories/auditLog.repository.ts';
import { dailyQuizRepository } from '../src/backend/repositories/dailyQuiz.repository.ts';
import { userRepository } from '../src/backend/repositories/user.repository.ts';
import {
  dailyQuizService,
  sanitizeDailyQuestionForClient,
} from '../src/backend/services/dailyQuiz.service.ts';
import { leaderboardService } from '../src/backend/services/leaderboard.service.ts';
import {
  computePromptFingerprint,
  moderateDisplayName,
  scoreEstimate,
  scoreMultipleChoice,
} from '../src/backend/utils/dailyQuiz.ts';

function makeApprovedQuestion(pos: number, overrides: Partial<DailyQuestion> = {}): DailyQuestion {
  return {
    id: `dq-${pos}`,
    dailyQuizId: 'quiz-1',
    position: pos,
    type: DailyQuestionType.MULTIPLE_CHOICE,
    prompt: `Question ${pos}: What is ${pos} + 1?`,
    codeSnippet: null,
    spokenText: null,
    options: [String(pos), String(pos + 1), String(pos + 2), String(pos + 3)],
    correctAnswer: '1',
    numericAnswer: null,
    scale: null,
    explanation: `Because ${pos} + 1 = ${pos + 1}.`,
    sourceUrl: 'https://example.com/source',
    license: 'CC-BY-4.0',
    status: DailyQuestionStatus.APPROVED,
    rejectionReason: null,
    generatedBy: DailyQuestionOrigin.HUMAN,
    fingerprint: computePromptFingerprint(`Question ${pos}: What is ${pos} + 1?`),
    lastUsedDate: '2026-11-19',
    isReserve: false,
    createdById: 'admin-1',
    reviewedById: 'admin-1',
    reviewedAt: new Date('2026-11-10T00:00:00Z'),
    createdAt: new Date('2026-11-10T00:00:00Z'),
    updatedAt: new Date('2026-11-10T00:00:00Z'),
    ...overrides,
  };
}

describe('Section 13: Daily Quiz Scoring', () => {
  it('implements exact ESTIMATE formula: exact=1000, off-by-scale=0, beyond=0, non-finite=0', () => {
    expect(scoreEstimate(100, 100, 50)).toBe(1000);
    expect(scoreEstimate('100', 100, 50)).toBe(1000);
    expect(scoreEstimate(125, 100, 50)).toBe(500);
    expect(scoreEstimate(75, 100, 50)).toBe(500);
    // off by exact scale => 0
    expect(scoreEstimate(150, 100, 50)).toBe(0);
    // beyond scale => clamped to 0
    expect(scoreEstimate(500, 100, 50)).toBe(0);
    expect(scoreEstimate(-100, 100, 50)).toBe(0);
    // rounding verification: 1 - 1/3 = 0.6666... => 667
    expect(scoreEstimate(110, 100, 30)).toBe(667);
    // non-finite / empty => 0
    expect(scoreEstimate(Number.NaN, 100, 50)).toBe(0);
    expect(scoreEstimate(Number.POSITIVE_INFINITY, 100, 50)).toBe(0);
    expect(scoreEstimate('NaN', 100, 50)).toBe(0);
    expect(scoreEstimate('not-a-number', 100, 50)).toBe(0);
    expect(scoreEstimate('', 100, 50)).toBe(0);
    expect(scoreEstimate(null, 100, 50)).toBe(0);
  });

  it('implements exact MULTIPLE_CHOICE formula: 1000 if correct else 0', () => {
    expect(scoreMultipleChoice('2', '2')).toBe(1000);
    expect(scoreMultipleChoice(' 2 ', '2')).toBe(1000);
    expect(scoreMultipleChoice('1', '2')).toBe(0);
    expect(scoreMultipleChoice(null, '2')).toBe(0);
  });
});

describe('Section 13: Leaderboard Tie-Break & Profanity Moderation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ranks higher score first, then lower totalTimeMs, and filters profane displayNames', async () => {
    expect(moderateDisplayName('AdaLovelace').approved).toBe(true);
    expect(moderateDisplayName('bad_shit_name').approved).toBe(false);

    vi.spyOn(userRepository, 'findById').mockResolvedValue({
      id: 'u-2',
      email: 'u2@test.com',
      passwordHash: 'h',
      name: null,
      displayName: 'GraceHopper',
      displayNameStatus: DisplayNameStatus.APPROVED,
      country: 'US',
      role: 'USER',
      timezone: 'UTC',
      isAdult: true,
      xp: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastStreakDate: null,
      stripeCustomerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Sorted order from repo: u-1 (6000, 15000ms), u-2 (6000, 22000ms), u-3 (5500, 9000ms)
    vi.spyOn(dailyQuizRepository, 'findAllLeaderboardForRank').mockResolvedValue([
      {
        id: 'le-1',
        userId: 'u-1',
        period: LeaderboardPeriod.DAILY,
        periodKey: '2026-11-19',
        score: 6000,
        timeMs: 15000,
        country: 'GB',
        updatedAt: new Date(),
        user: { id: 'u-1', displayName: 'AlanTuring', country: 'GB' },
      },
      {
        id: 'le-2',
        userId: 'u-2',
        period: LeaderboardPeriod.DAILY,
        periodKey: '2026-11-19',
        score: 6000,
        timeMs: 22000,
        country: 'US',
        updatedAt: new Date(),
        user: { id: 'u-2', displayName: 'GraceHopper', country: 'US' },
      },
      {
        id: 'le-3',
        userId: 'u-3',
        period: LeaderboardPeriod.DAILY,
        periodKey: '2026-11-19',
        score: 5500,
        timeMs: 9000,
        country: 'CA',
        updatedAt: new Date(),
        user: { id: 'u-3', displayName: 'Linus', country: 'CA' },
      },
    ]);

    const meRes = await leaderboardService.getMyRankAndNeighbors({
      userId: 'u-2',
      period: 'daily',
      periodKey: '2026-11-19',
    });

    expect(meRes.eligible).toBe(true);
    expect(meRes.rank).toBe(2);
    expect(meRes.neighbors.map((n) => n.userId)).toEqual(['u-1', 'u-2', 'u-3']);

    // Unmoderated / rejected user cannot appear on leaderboard
    vi.spyOn(userRepository, 'findById').mockResolvedValueOnce({
      id: 'u-4',
      email: 'u4@test.com',
      passwordHash: 'h',
      name: null,
      displayName: null,
      displayNameStatus: DisplayNameStatus.REJECTED,
      country: null,
      role: 'USER',
      timezone: 'UTC',
      isAdult: true,
      xp: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastStreakDate: null,
      stripeCustomerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const blockedRes = await leaderboardService.getMyRankAndNeighbors({
      userId: 'u-4',
      period: 'daily',
    });
    expect(blockedRes.eligible).toBe(false);
    expect(blockedRes.rank).toBeNull();
  });

  it('rejects profane displayName updates and marks status REJECTED', async () => {
    const updateSpy = vi
      .spyOn(dailyQuizRepository, 'updateUserProfile')
      .mockResolvedValue({
        id: 'u-1',
        email: 'u1@test.com',
        displayName: null,
        displayNameStatus: DisplayNameStatus.REJECTED,
        country: null,
      });

    await expect(
      leaderboardService.updateDisplayNameAndCountry('u-1', { displayName: 'fuck_this' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'DISPLAY_NAME_REJECTED' });

    expect(updateSpy).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ displayName: null, displayNameStatus: DisplayNameStatus.REJECTED }),
    );
  });
});

describe('Section 13: Gameplay Rules (One Attempt, Time Limit, Date Boundary, Answer Gating)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enforces one attempt per user per quizDate (no retries)', async () => {
    vi.spyOn(dailyQuizRepository, 'findAttempt').mockResolvedValue({
      id: 'att-1',
      userId: 'u-1',
      dailyQuizId: 'quiz-1',
      quizDate: '2026-11-19',
      startedAt: new Date('2026-11-19T10:00:00Z'),
      currentPosition: 1,
      currentQuestionStartedAt: new Date('2026-11-19T10:00:00Z'),
      finishedAt: new Date('2026-11-19T10:03:00Z'),
      totalScore: 5000,
      totalTimeMs: 90000,
      answers: [],
      dailyQuiz: {
        id: 'quiz-1',
        quizDate: '2026-11-19',
        status: DailyQuizStatus.LIVE,
        publishedAt: new Date(),
        closedAt: null,
        usedReserveFallback: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        questions: [],
      },
    });

    await expect(
      dailyQuizService.startDailyQuiz('u-1', new Date('2026-11-19T12:00:00Z')),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DAILY_ATTEMPT_ALREADY_EXISTS' });
  });

  it('enforces server-side per-question time limit and gives 0 on late or missing answers', async () => {
    const q1 = makeApprovedQuestion(1, { correctAnswer: '1' });
    const startedAt = new Date('2026-11-19T12:00:00.000Z');

    vi.spyOn(dailyQuizRepository, 'findAttempt').mockResolvedValue({
      id: 'att-1',
      userId: 'u-1',
      dailyQuizId: 'quiz-1',
      quizDate: '2026-11-19',
      startedAt,
      currentPosition: 1,
      currentQuestionStartedAt: startedAt,
      finishedAt: null,
      totalScore: 0,
      totalTimeMs: 0,
      answers: [],
      dailyQuiz: {
        id: 'quiz-1',
        quizDate: '2026-11-19',
        status: DailyQuizStatus.LIVE,
        publishedAt: startedAt,
        closedAt: null,
        usedReserveFallback: false,
        createdAt: startedAt,
        updatedAt: startedAt,
        questions: [q1],
      },
    });

    vi.spyOn(userRepository, 'findById').mockResolvedValue(null);
    vi.spyOn(dailyQuizRepository, 'getAristotleTemplate').mockResolvedValue(null);
    vi.spyOn(prisma, '$transaction').mockImplementation(async (fn) => fn({} as never));

    const recordSpy = vi
      .spyOn(dailyQuizRepository, 'recordAnswerAndAdvance')
      .mockImplementation(async (params) => ({
        answer: {
          id: 'ans-1',
          attemptId: params.attemptId,
          questionId: params.questionId,
          position: params.position,
          givenValue: params.givenValue,
          score: params.score,
          timeMs: params.timeMs,
          isLate: params.isLate,
          submittedAt: params.now,
        },
        attempt: {
          id: params.attemptId,
          userId: params.userId,
          dailyQuizId: 'quiz-1',
          quizDate: params.quizDate,
          startedAt,
          currentPosition: 2,
          currentQuestionStartedAt: params.now,
          finishedAt: null,
          totalScore: params.score,
          totalTimeMs: params.timeMs,
        },
      }));

    // 61 seconds elapsed (> DAILY_QUESTION_SECONDS = 60): correct answer still scores 0 & isLate=true
    const lateNow = new Date(startedAt.getTime() + (env.DAILY_QUESTION_SECONDS + 1) * 1000);
    const lateRes = await dailyQuizService.submitDailyAnswer(
      'u-1',
      { questionId: 'dq-1', givenValue: '1' },
      lateNow,
    );

    expect(lateRes.isLate).toBe(true);
    expect(lateRes.score).toBe(0);
    expect(lateRes.correctAnswer).toBe('1');
    expect(lateRes.explanation).toBe(q1.explanation);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({ score: 0, isLate: true }),
      expect.anything(),
    );

    // Within limit (10s elapsed) + valid answer => scores 1000
    const onTimeNow = new Date(startedAt.getTime() + 10_000);
    const onTimeRes = await dailyQuizService.submitDailyAnswer(
      'u-1',
      { questionId: 'dq-1', givenValue: '1' },
      onTimeNow,
    );
    expect(onTimeRes.isLate).toBe(false);
    expect(onTimeRes.score).toBe(1000);
    expect(onTimeRes.timeMs).toBe(10_000);
  });

  it('enforces server date boundary at 23:59:59 vs 00:00:00 in DAILY_TZ', async () => {
    const beforeMidnight = new Date('2026-11-19T23:59:59Z');
    const afterMidnight = new Date('2026-11-20T00:00:00Z');

    expect(dailyQuizService.getServerTodayDate(beforeMidnight)).toBe('2026-11-19');
    expect(dailyQuizService.getServerTodayDate(afterMidnight)).toBe('2026-11-20');

    // Submitting 2026-11-19 attempt 1 second later at 00:00:00Z must be rejected cleanly
    await expect(
      dailyQuizService.submitDailyAnswer(
        'u-1',
        { questionId: 'dq-1', givenValue: '1', quizDate: '2026-11-19' },
        afterMidnight,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'QUIZ_DATE_EXPIRED' });

    await expect(
      dailyQuizService.getCurrentQuestion('u-1', afterMidnight, '2026-11-19'),
    ).rejects.toMatchObject({ statusCode: 409, code: 'QUIZ_DATE_EXPIRED' });
  });

  it('hides answers & explanations until submission/completion and never serves non-APPROVED questions', async () => {
    const questions = [1, 2, 3, 4, 5, 6, 7].map((pos) => makeApprovedQuestion(pos));
    const draftQuestion = makeApprovedQuestion(1, { status: DailyQuestionStatus.DRAFT });

    expect(() => sanitizeDailyQuestionForClient(draftQuestion)).toThrow();

    const sanitized = sanitizeDailyQuestionForClient(questions[0]);
    expect(sanitized).not.toHaveProperty('correctAnswer');
    expect(sanitized).not.toHaveProperty('numericAnswer');
    expect(sanitized).not.toHaveProperty('explanation');

    // Result endpoint is locked until finishedAt != null
    vi.spyOn(dailyQuizRepository, 'findAttempt').mockResolvedValue({
      id: 'att-1',
      userId: 'u-1',
      dailyQuizId: 'quiz-1',
      quizDate: '2026-11-19',
      startedAt: new Date(),
      currentPosition: 2,
      currentQuestionStartedAt: new Date(),
      finishedAt: null,
      totalScore: 1000,
      totalTimeMs: 5000,
      answers: [],
      dailyQuiz: {
        id: 'quiz-1',
        quizDate: '2026-11-19',
        status: DailyQuizStatus.LIVE,
        publishedAt: new Date(),
        closedAt: null,
        usedReserveFallback: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        questions,
      },
    });

    await expect(
      dailyQuizService.getDailyResult('u-1', '2026-11-19'),
    ).rejects.toMatchObject({ statusCode: 403, code: 'DAILY_RESULT_LOCKED' });

    // Start endpoint omits answers/explanations
    vi.spyOn(dailyQuizRepository, 'findAttempt').mockResolvedValueOnce(null);
    vi.spyOn(dailyQuizRepository, 'findQuizByDate').mockResolvedValue({
      id: 'quiz-1',
      quizDate: '2026-11-19',
      status: DailyQuizStatus.LIVE,
      publishedAt: new Date(),
      closedAt: null,
      usedReserveFallback: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      questions,
    });
    vi.spyOn(dailyQuizRepository, 'getAristotleTemplate').mockResolvedValue({
      id: 'tpl-1',
      key: AristotleTemplateKey.INTRO,
      title: 'Intro',
      body: 'Welcome {{quizDate}}',
      language: 'en',
      voiceId: 'aristotle',
      updatedById: null,
      updatedAt: new Date(),
    });
    vi.spyOn(dailyQuizRepository, 'createAttempt').mockResolvedValue({
      id: 'att-new',
      userId: 'u-1',
      dailyQuizId: 'quiz-1',
      quizDate: '2026-11-19',
      startedAt: new Date(),
      currentPosition: 1,
      currentQuestionStartedAt: new Date(),
      finishedAt: null,
      totalScore: 0,
      totalTimeMs: 0,
      answers: [],
      dailyQuiz: {
        id: 'quiz-1',
        quizDate: '2026-11-19',
        status: DailyQuizStatus.LIVE,
        publishedAt: new Date(),
        closedAt: null,
        usedReserveFallback: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        questions,
      },
    });

    const started = await dailyQuizService.startDailyQuiz('u-1', new Date('2026-11-19T12:00:00Z'));
    expect(started.question).not.toHaveProperty('correctAnswer');
    expect(started.question).not.toHaveProperty('numericAnswer');
    expect(started.question).not.toHaveProperty('explanation');
  });
});

describe('Section 13: Scheduler Idempotency, Reserve Fallback & 365-Day Fingerprint Pipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a LIVE quiz from reserve pool and creates an admin alert without erroring to users', async () => {
    const reserve = [1, 2, 3, 4, 5, 6, 7].map((p) =>
      makeApprovedQuestion(p, { id: `res-${p}`, dailyQuizId: null, position: null, isReserve: true }),
    );
    const assigned = reserve.map((q, idx) => ({ ...q, dailyQuizId: 'quiz-fallback', position: idx + 1 }));

    vi.spyOn(dailyQuizRepository, 'findQuizByDate').mockResolvedValue(null);
    vi.spyOn(dailyQuizRepository, 'findUnusedApprovedReserveQuestions').mockResolvedValue(reserve);
    vi.spyOn(dailyQuizRepository, 'findOpenAlert').mockResolvedValue(null);
    const alertSpy = vi
      .spyOn(dailyQuizRepository, 'createAdminAlert')
      .mockResolvedValue({
        id: 'al-1',
        type: 'RESERVE_FALLBACK_USED',
        message: 'alert',
        quizDate: '2026-11-19',
        resolvedAt: null,
        createdAt: new Date(),
      });

    vi.spyOn(prisma, '$transaction').mockImplementation(async (fn) =>
      fn({
        dailyQuiz: {
          upsert: vi.fn().mockResolvedValue({
            id: 'quiz-fallback',
            quizDate: '2026-11-19',
            status: DailyQuizStatus.BUFFERED,
            questions: [],
          }),
          update: vi.fn().mockResolvedValue({
            id: 'quiz-fallback',
            quizDate: '2026-11-19',
            status: DailyQuizStatus.LIVE,
            publishedAt: new Date(),
            closedAt: null,
            usedReserveFallback: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            questions: assigned,
          }),
        },
        dailyQuestion: {
          update: vi.fn().mockResolvedValue({}),
        },
      } as never),
    );
    vi.spyOn(dailyQuizRepository, 'markQuizLive').mockResolvedValue({
      id: 'quiz-fallback',
      quizDate: '2026-11-19',
      status: DailyQuizStatus.LIVE,
      publishedAt: new Date(),
      closedAt: null,
      usedReserveFallback: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      questions: assigned,
    });

    const result = await dailyQuizService.ensureLiveQuizForDate(
      '2026-11-19',
      new Date('2026-11-19T08:00:00Z'),
    );

    expect(result.usedReserveFallback).toBe(true);
    expect(result.approvedQuestions).toHaveLength(7);
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RESERVE_FALLBACK_USED', quizDate: '2026-11-19' }),
    );
  });

  it('is idempotent when runDailyScheduler is called twice consecutively', async () => {
    const todayQuestions = [1, 2, 3, 4, 5, 6, 7].map((p) => makeApprovedQuestion(p));
    const bufferedQuizzes = new Map<string, ReturnType<typeof makeQuiz>>();
    function makeQuiz(quizDate: string, status: DailyQuizStatus) {
      return {
        id: `quiz-${quizDate}`,
        quizDate,
        status,
        publishedAt: status === DailyQuizStatus.LIVE ? new Date() : null,
        closedAt: null,
        usedReserveFallback: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        questions: todayQuestions.map((q) => ({ ...q, id: `${quizDate}-${q.id}` })),
      };
    }

    // Initially today & 7 buffer days are already ready except yesterday is still LIVE
    bufferedQuizzes.set('2026-11-19', makeQuiz('2026-11-19', DailyQuizStatus.BUFFERED));
    let staleClosed = false;

    vi.spyOn(dailyQuizRepository, 'findQuizByDate').mockImplementation(async (d) => {
      if (d === '2026-11-19') return bufferedQuizzes.get(d)!;
      return bufferedQuizzes.get(d) ?? makeQuiz(d, DailyQuizStatus.BUFFERED);
    });
    vi.spyOn(dailyQuizRepository, 'markQuizLive').mockImplementation(async (id) => {
      const q = bufferedQuizzes.get('2026-11-19')!;
      q.status = DailyQuizStatus.LIVE;
      return { ...q, id };
    });
    vi.spyOn(dailyQuizRepository, 'findLiveQuizzesBeforeDate').mockImplementation(async () =>
      staleClosed ? [] : [makeQuiz('2026-11-18', DailyQuizStatus.LIVE)],
    );
    vi.spyOn(prisma, '$transaction').mockImplementation(async (fn) => fn({} as never));
    const closeSpy = vi.spyOn(dailyQuizRepository, 'markQuizClosed').mockImplementation(async (id) => {
      staleClosed = true;
      return makeQuiz('2026-11-18', DailyQuizStatus.CLOSED);
    });
    const finalizeSpy = vi
      .spyOn(dailyQuizRepository, 'finalizeLeaderboardForDate')
      .mockResolvedValue(undefined);

    const run1 = await dailyQuizService.runDailyScheduler(new Date('2026-11-19T00:00:00Z'));
    const run2 = await dailyQuizService.runDailyScheduler(new Date('2026-11-19T00:00:05Z'));

    expect(run1.closedCount).toBe(1);
    expect(run2.closedCount).toBe(0);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(finalizeSpy).toHaveBeenCalledTimes(1);
  });

  it('enforces 365-day fingerprint deduplication, AI DRAFT status, range sanity, and code sandbox check', async () => {
    // 1. Fingerprint normalization + 365-day duplicate block
    const f1 = computePromptFingerprint('  What is the ASCII code of A? ');
    const f2 = computePromptFingerprint('what is   the ascii code of a!!!');
    expect(f1).toBe(f2);

    vi.spyOn(dailyQuizRepository, 'findRecentFingerprintMatch').mockResolvedValueOnce(
      makeApprovedQuestion(1),
    );
    await expect(
      dailyQuizService.submitQuestionCandidate('admin-1', {
        type: DailyQuestionType.ESTIMATE,
        prompt: 'What is the ASCII code of A?',
        correctAnswer: '65',
        numericAnswer: 65,
        scale: 20,
        explanation: 'Uppercase A is ASCII 65.',
        sourceUrl: 'https://en.wikipedia.org/wiki/ASCII',
        generatedBy: DailyQuestionOrigin.AI,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_FINGERPRINT' });

    // 2. Insane numericAnswer for scale rejected
    await expect(
      dailyQuizService.submitQuestionCandidate('admin-1', {
        type: DailyQuestionType.ESTIMATE,
        prompt: 'Unique numeric range test question',
        correctAnswer: '9999999',
        numericAnswer: 9999999,
        scale: 5,
        explanation: 'Range sanity check.',
        sourceUrl: 'https://example.com',
        generatedBy: DailyQuestionOrigin.AI,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'NUMERIC_ANSWER_OUT_OF_RANGE' });

    // 3. Code-output sandbox mismatch rejected
    await expect(
      dailyQuizService.submitQuestionCandidate('admin-1', {
        type: DailyQuestionType.MULTIPLE_CHOICE,
        prompt: 'What does this JS snippet print?',
        codeSnippet: 'console.log(2 + 2 * 3);',
        options: ['12', '8', '6', '10'],
        correctAnswer: '0', // claims '12', actual is '8'
        explanation: 'Multiplication precedes addition.',
        generatedBy: DailyQuestionOrigin.AI,
        isCodeOutput: true,
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'SANDBOX_KEY_MISMATCH' });

    // 4. Valid AI candidate passes sandbox & is strictly forced to DRAFT
    vi.spyOn(dailyQuizRepository, 'findRecentFingerprintMatch').mockResolvedValueOnce(null);
    const createSpy = vi
      .spyOn(dailyQuizRepository, 'createQuestion')
      .mockImplementation(async (data) =>
        makeApprovedQuestion(1, {
          status: data.status,
          generatedBy: data.generatedBy,
          fingerprint: data.fingerprint,
        }),
      );
    vi.spyOn(auditLogRepository, 'create').mockResolvedValue({} as never);

    const created = await dailyQuizService.submitQuestionCandidate('admin-1', {
      type: DailyQuestionType.MULTIPLE_CHOICE,
      prompt: 'What does console.log(2 + 2 * 3) output?',
      codeSnippet: 'console.log(2 + 2 * 3);',
      options: ['12', '8', '6', '10'],
      correctAnswer: '1',
      explanation: 'Multiplication executes before addition, logging 8.',
      generatedBy: DailyQuestionOrigin.AI,
      isCodeOutput: true,
    });

    expect(created.status).toBe(DailyQuestionStatus.DRAFT);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: DailyQuestionStatus.DRAFT,
        generatedBy: DailyQuestionOrigin.AI,
      }),
    );
  });
});
