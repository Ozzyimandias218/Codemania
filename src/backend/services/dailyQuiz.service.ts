import {
  AristotleTemplateKey,
  DailyQuestion,
  DailyQuestionOrigin,
  DailyQuestionStatus,
  DailyQuestionType,
  DailyQuizStatus,
  Prisma,
} from '@prisma/client';
import { env } from '../config/env.ts';
import { prisma } from '../config/prisma.ts';
import { auditLogRepository } from '../repositories/auditLog.repository.ts';
import { dailyQuizRepository } from '../repositories/dailyQuiz.repository.ts';
import { userRepository } from '../repositories/user.repository.ts';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../utils/errors.ts';
import {
  computePromptFingerprint,
  executeCodeSnippetSandbox,
  renderAristotleTemplate,
  scoreEstimate,
  scoreMultipleChoice,
} from '../utils/dailyQuiz.ts';
import { addDaysToDateString, formatDateInTimezone } from '../utils/timezone.ts';
import { voiceService } from './tts/voice.service.ts';

export const DAILY_QUIZ_QUESTION_COUNT = 7;
export const FINGERPRINT_WINDOW_DAYS = 365;
export const MAX_ESTIMATE_SCALE_RATIO = 1000;

export interface SanitizedDailyQuestion {
  id: string;
  position: number;
  type: DailyQuestionType;
  prompt: string;
  codeSnippet: string | null;
  spokenText: string | null;
  options: unknown;
}

export function sanitizeDailyQuestionForClient(q: DailyQuestion): SanitizedDailyQuestion {
  if (q.status !== DailyQuestionStatus.APPROVED) {
    throw new ForbiddenError('Non-approved daily questions cannot be served');
  }
  return {
    id: q.id,
    position: q.position ?? 0,
    type: q.type,
    prompt: q.prompt,
    codeSnippet: q.codeSnippet,
    spokenText: q.spokenText,
    options: q.type === DailyQuestionType.MULTIPLE_CHOICE ? q.options : null,
  };
}

export function validateDailyQuestionCandidatePayload(input: {
  type: DailyQuestionType;
  prompt: string;
  codeSnippet?: string | null;
  options?: string[] | null;
  correctAnswer?: string | null;
  numericAnswer?: number | null;
  scale?: number | null;
  explanation: string;
  sourceUrl?: string | null;
  license?: string | null;
  generatedBy: DailyQuestionOrigin;
  isFactualClaim?: boolean;
  isCodeOutput?: boolean;
}): { normalizedCorrectAnswer: string } {
  if (!input.prompt || input.prompt.trim().length < 5) {
    throw new BadRequestError('Question prompt must be at least 5 characters');
  }
  if (!input.explanation || input.explanation.trim().length === 0) {
    throw new BadRequestError('Explanation must be non-empty');
  }

  let normalizedCorrectAnswer = (input.correctAnswer ?? '').trim();

  if (input.type === DailyQuestionType.ESTIMATE) {
    if (
      input.numericAnswer === null ||
      input.numericAnswer === undefined ||
      !Number.isFinite(input.numericAnswer)
    ) {
      throw new BadRequestError('ESTIMATE question requires a finite numericAnswer');
    }
    if (
      input.scale === null ||
      input.scale === undefined ||
      !Number.isFinite(input.scale) ||
      input.scale <= 0
    ) {
      throw new BadRequestError('ESTIMATE question requires scale > 0');
    }
    if (Math.abs(input.numericAnswer) > input.scale * MAX_ESTIMATE_SCALE_RATIO) {
      throw new BadRequestError(
        `ESTIMATE numericAnswer is out of sane range for scale (max ${MAX_ESTIMATE_SCALE_RATIO}x scale)`,
        'NUMERIC_ANSWER_OUT_OF_RANGE',
      );
    }
    normalizedCorrectAnswer = String(input.numericAnswer);
  } else {
    if (!Array.isArray(input.options) || input.options.length !== 4) {
      throw new BadRequestError('MULTIPLE_CHOICE question requires exactly 4 options');
    }
    if (input.options.some((opt) => typeof opt !== 'string' || opt.trim().length === 0)) {
      throw new BadRequestError('All 4 options must be non-empty strings');
    }
    if (!['0', '1', '2', '3'].includes(normalizedCorrectAnswer)) {
      throw new BadRequestError('MULTIPLE_CHOICE correctAnswer must be index "0", "1", "2", or "3"');
    }
  }

  const requiresSourceUrl =
    input.isFactualClaim === true ||
    (!input.codeSnippet && input.generatedBy === DailyQuestionOrigin.AI);
  if (requiresSourceUrl && (!input.sourceUrl || input.sourceUrl.trim().length === 0)) {
    throw new BadRequestError(
      'sourceUrl is required for factual claims and sourced AI questions',
      'SOURCE_URL_REQUIRED',
    );
  }

  // Execute code-output snippets in isolated VM sandbox and verify against the key
  const shouldRunSandbox =
    Boolean(input.codeSnippet && input.codeSnippet.trim().length > 0) &&
    (input.isCodeOutput === true || input.codeSnippet!.includes('console.log'));

  if (shouldRunSandbox && input.codeSnippet) {
    const sandboxResult = executeCodeSnippetSandbox(input.codeSnippet);
    if (!sandboxResult.ok) {
      throw new BadRequestError(
        `Code snippet sandbox execution failed: ${sandboxResult.error}`,
        'SANDBOX_EXECUTION_FAILED',
      );
    }

    if (input.type === DailyQuestionType.ESTIMATE) {
      const actualNum = Number(sandboxResult.stdout);
      if (!Number.isFinite(actualNum) || actualNum !== input.numericAnswer) {
        throw new BadRequestError(
          `Sandbox output (${sandboxResult.stdout}) does not match numericAnswer (${input.numericAnswer})`,
          'SANDBOX_KEY_MISMATCH',
        );
      }
    } else {
      const expectedText = input.options![Number(normalizedCorrectAnswer)].trim();
      if (sandboxResult.stdout !== expectedText) {
        throw new BadRequestError(
          `Sandbox output (${sandboxResult.stdout}) does not match chosen option (${expectedText})`,
          'SANDBOX_KEY_MISMATCH',
        );
      }
    }
  }

  return { normalizedCorrectAnswer };
}

export class DailyQuizService {
  getServerTodayDate(now: Date = new Date()): string {
    return formatDateInTimezone(now, env.DAILY_TZ);
  }

  private async createAlertIfNoneOpen(params: {
    type: string;
    message: string;
    quizDate?: string;
  }): Promise<boolean> {
    const existing = await dailyQuizRepository.findOpenAlert(params.type, params.quizDate);
    if (existing) {
      return false;
    }
    await dailyQuizRepository.createAdminAlert(params);
    return true;
  }

  private async renderTemplate(
    key: AristotleTemplateKey,
    vars: Record<string, string | number>,
    fallbackBody: string,
  ): Promise<string> {
    const tpl = await dailyQuizRepository.getAristotleTemplate(key);
    return renderAristotleTemplate(tpl?.body ?? fallbackBody, vars);
  }

  /**
   * Ensures today's quiz is LIVE with 7 APPROVED questions.
   * Falls back to the unused (365-day rule) APPROVED reserve pool and alerts admins
   * without failing user requests if no buffered quiz is ready.
   */
  async ensureLiveQuizForDate(quizDate: string, now: Date = new Date()) {
    const existing = await dailyQuizRepository.findQuizByDate(quizDate);
    const approvedExisting = (existing?.questions ?? [])
      .filter((q) => q.status === DailyQuestionStatus.APPROVED)
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));

    if (
      existing?.status === DailyQuizStatus.LIVE &&
      approvedExisting.length === DAILY_QUIZ_QUESTION_COUNT
    ) {
      return { quiz: existing, approvedQuestions: approvedExisting, usedReserveFallback: existing.usedReserveFallback };
    }

    if (
      existing &&
      existing.status !== DailyQuizStatus.CLOSED &&
      approvedExisting.length === DAILY_QUIZ_QUESTION_COUNT
    ) {
      const promoted = await dailyQuizRepository.markQuizLive(existing.id, false, now);
      return {
        quiz: promoted,
        approvedQuestions: approvedExisting,
        usedReserveFallback: false,
      };
    }

    // Reserve fallback path
    const needed = DAILY_QUIZ_QUESTION_COUNT - approvedExisting.length;
    const cutoffDateStr = addDaysToDateString(quizDate, -FINGERPRINT_WINDOW_DAYS);
    const reserveQuestions =
      needed > 0
        ? await dailyQuizRepository.findUnusedApprovedReserveQuestions(cutoffDateStr, needed)
        : [];

    if (reserveQuestions.length < needed) {
      await this.createAlertIfNoneOpen({
        type: 'INSUFFICIENT_RESERVE_QUESTIONS',
        quizDate,
        message: `Reserve pool has only ${reserveQuestions.length}/${needed} approved unused questions needed for ${quizDate}.`,
      });
      return { quiz: existing, approvedQuestions: approvedExisting, usedReserveFallback: false };
    }

    const usedPositions = new Set(
      approvedExisting.map((q) => q.position).filter((p): p is number => p !== null),
    );
    const openPositions: number[] = [];
    for (let pos = 1; pos <= DAILY_QUIZ_QUESTION_COUNT; pos++) {
      if (!usedPositions.has(pos)) {
        openPositions.push(pos);
      }
    }

    const quiz = await prisma.$transaction(async (tx) => {
      const targetQuiz = await dailyQuizRepository.createOrGetQuizForDate(
        quizDate,
        DailyQuizStatus.BUFFERED,
        tx,
      );
      for (let i = 0; i < reserveQuestions.length; i++) {
        await tx.dailyQuestion.update({
          where: { id: reserveQuestions[i].id },
          data: {
            dailyQuizId: targetQuiz.id,
            position: openPositions[i],
            lastUsedDate: quizDate,
            isReserve: false,
          },
        });
      }
      return dailyQuizRepository.markQuizLive(targetQuiz.id, true, now, tx);
    });

    await this.createAlertIfNoneOpen({
      type: 'RESERVE_FALLBACK_USED',
      quizDate,
      message: `Zugzwang for ${quizDate} was built automatically from the reserve pool (${needed} questions drawn).`,
    });

    const finalApproved = quiz.questions
      .filter((q) => q.status === DailyQuestionStatus.APPROVED)
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));

    return { quiz, approvedQuestions: finalApproved, usedReserveFallback: true };
  }

  async getTodayState(userId: string, now: Date = new Date()) {
    const todayDate = this.getServerTodayDate(now);
    const { approvedQuestions } = await this.ensureLiveQuizForDate(todayDate, now);
    const attempt = await dailyQuizRepository.findAttempt(userId, todayDate);

    const intro = await this.renderTemplate(
      AristotleTemplateKey.INTRO,
      {
        quizDate: todayDate,
        questionCount: DAILY_QUIZ_QUESTION_COUNT,
        timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
      },
      `Welcome to Zugzwang for {{quizDate}}. Answer {{questionCount}} questions, {{timeLimitSeconds}}s each.`,
    );

    if (!attempt) {
      return {
        quizDate: todayDate,
        dailyTz: env.DAILY_TZ,
        state: 'NOT_STARTED' as const,
        available: approvedQuestions.length === DAILY_QUIZ_QUESTION_COUNT,
        timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
        timeRemainingSeconds: null,
        totalQuestions: DAILY_QUIZ_QUESTION_COUNT,
        aristotleIntro: intro,
      };
    }

    if (attempt.finishedAt) {
      return {
        quizDate: todayDate,
        dailyTz: env.DAILY_TZ,
        state: 'DONE' as const,
        available: true,
        timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
        timeRemainingSeconds: 0,
        totalQuestions: DAILY_QUIZ_QUESTION_COUNT,
        totalScore: attempt.totalScore,
        totalTimeMs: attempt.totalTimeMs,
        aristotleIntro: intro,
      };
    }

    const elapsedMs = Math.max(0, now.getTime() - attempt.currentQuestionStartedAt.getTime());
    const limitMs = env.DAILY_QUESTION_SECONDS * 1000;
    const timeRemainingSeconds = Math.max(0, Math.ceil((limitMs - elapsedMs) / 1000));

    return {
      quizDate: todayDate,
      dailyTz: env.DAILY_TZ,
      state: 'IN_PROGRESS' as const,
      available: true,
      currentPosition: attempt.currentPosition,
      totalQuestions: DAILY_QUIZ_QUESTION_COUNT,
      timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
      timeRemainingSeconds,
      totalScore: attempt.totalScore,
      totalTimeMs: attempt.totalTimeMs,
      aristotleIntro: intro,
    };
  }

  async startDailyQuiz(userId: string, now: Date = new Date()) {
    const todayDate = this.getServerTodayDate(now);
    const existingAttempt = await dailyQuizRepository.findAttempt(userId, todayDate);
    if (existingAttempt) {
      throw new ConflictError(
        `You already have an attempt for ${todayDate}. Retries are not allowed.`,
        'DAILY_ATTEMPT_ALREADY_EXISTS',
      );
    }

    const { quiz, approvedQuestions } = await this.ensureLiveQuizForDate(todayDate, now);
    if (!quiz || approvedQuestions.length !== DAILY_QUIZ_QUESTION_COUNT) {
      throw new ConflictError(
        'Today’s Zugzwang does not have 7 approved questions ready',
        'DAILY_QUIZ_UNAVAILABLE',
      );
    }

    const firstQuestion = approvedQuestions.find((q) => q.position === 1);
    if (!firstQuestion || firstQuestion.status !== DailyQuestionStatus.APPROVED) {
      throw new ConflictError('Question 1 is not approved or available', 'DAILY_QUIZ_UNAVAILABLE');
    }

    const attempt = await dailyQuizRepository.createAttempt({
      userId,
      dailyQuizId: quiz.id,
      quizDate: todayDate,
      now,
    });

    const aristotleIntro = await this.renderTemplate(
      AristotleTemplateKey.INTRO,
      {
        quizDate: todayDate,
        questionCount: DAILY_QUIZ_QUESTION_COUNT,
        timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
      },
      `Welcome to Zugzwang for {{quizDate}}.`,
    );

    return {
      attemptId: attempt.id,
      quizDate: todayDate,
      state: 'IN_PROGRESS' as const,
      currentPosition: 1,
      totalQuestions: DAILY_QUIZ_QUESTION_COUNT,
      timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
      timeRemainingSeconds: env.DAILY_QUESTION_SECONDS,
      aristotleIntro,
      question: sanitizeDailyQuestionForClient(firstQuestion),
    };
  }

  async getCurrentQuestion(userId: string, now: Date = new Date(), requestedQuizDate?: string) {
    const todayDate = this.getServerTodayDate(now);
    if (requestedQuizDate && requestedQuizDate !== todayDate) {
      throw new ConflictError(
        `Quiz date ${requestedQuizDate} is not active today (${todayDate} in ${env.DAILY_TZ})`,
        'QUIZ_DATE_EXPIRED',
      );
    }

    const attempt = await dailyQuizRepository.findAttempt(userId, todayDate);
    if (!attempt) {
      throw new NotFoundError('No Zugzwang attempt started for today', 'DAILY_ATTEMPT_NOT_FOUND');
    }
    if (attempt.quizDate !== todayDate) {
      throw new ConflictError(
        'Attempt quiz date has expired across the midnight boundary',
        'QUIZ_DATE_EXPIRED',
      );
    }
    if (attempt.finishedAt) {
      throw new ConflictError('Zugzwang attempt is already completed', 'DAILY_ATTEMPT_FINISHED');
    }

    const currentQuestion = attempt.dailyQuiz.questions.find(
      (q) => q.position === attempt.currentPosition && q.status === DailyQuestionStatus.APPROVED,
    );
    if (!currentQuestion) {
      throw new NotFoundError('Current approved daily question not found');
    }

    const elapsedMs = Math.max(0, now.getTime() - attempt.currentQuestionStartedAt.getTime());
    const limitMs = env.DAILY_QUESTION_SECONDS * 1000;
    const timeRemainingSeconds = Math.max(0, Math.ceil((limitMs - elapsedMs) / 1000));

    return {
      attemptId: attempt.id,
      quizDate: attempt.quizDate,
      currentPosition: attempt.currentPosition,
      totalQuestions: DAILY_QUIZ_QUESTION_COUNT,
      timeLimitSeconds: env.DAILY_QUESTION_SECONDS,
      timeRemainingSeconds,
      isTimedOut: elapsedMs > limitMs,
      question: sanitizeDailyQuestionForClient(currentQuestion),
    };
  }

  async submitDailyAnswer(
    userId: string,
    input: {
      questionId: string;
      givenValue?: string | number | null;
      quizDate?: string;
    },
    now: Date = new Date(),
  ) {
    const todayDate = this.getServerTodayDate(now);
    if (input.quizDate && input.quizDate !== todayDate) {
      throw new ConflictError(
        `Attempt for ${input.quizDate} is rejected because current date in ${env.DAILY_TZ} is ${todayDate}`,
        'QUIZ_DATE_EXPIRED',
      );
    }

    const attempt = await dailyQuizRepository.findAttempt(userId, todayDate);
    if (!attempt) {
      throw new NotFoundError('No active Zugzwang attempt for today', 'DAILY_ATTEMPT_NOT_FOUND');
    }
    if (attempt.quizDate !== todayDate) {
      throw new ConflictError(
        'Attempt date no longer matches current server date in DAILY_TZ',
        'QUIZ_DATE_EXPIRED',
      );
    }
    if (attempt.finishedAt) {
      throw new ConflictError('Zugzwang attempt is already finished', 'DAILY_ATTEMPT_FINISHED');
    }

    const currentQuestion = attempt.dailyQuiz.questions.find(
      (q) => q.position === attempt.currentPosition,
    );
    if (!currentQuestion || currentQuestion.id !== input.questionId) {
      throw new ConflictError(
        'Submitted question does not match current question position',
        'QUESTION_POSITION_MISMATCH',
      );
    }
    if (currentQuestion.status !== DailyQuestionStatus.APPROVED) {
      throw new ForbiddenError('Cannot score non-approved daily question');
    }

    // Server-side time limit: client timestamps are strictly ignored.
    const elapsedMs = Math.max(0, now.getTime() - attempt.currentQuestionStartedAt.getTime());
    const limitMs = env.DAILY_QUESTION_SECONDS * 1000;
    const isLate = elapsedMs > limitMs;

    const normalizedGiven =
      input.givenValue === undefined || input.givenValue === null
        ? null
        : String(input.givenValue);
    const isMissing = normalizedGiven === null || normalizedGiven.trim() === '';

    let score = 0;
    if (!isLate && !isMissing) {
      if (currentQuestion.type === DailyQuestionType.ESTIMATE) {
        score = scoreEstimate(
          normalizedGiven,
          currentQuestion.numericAnswer ?? NaN,
          currentQuestion.scale ?? 0,
        );
      } else {
        score = scoreMultipleChoice(normalizedGiven, currentQuestion.correctAnswer);
      }
    }

    const user = await userRepository.findById(userId);
    const isFinalQuestion = attempt.currentPosition >= DAILY_QUIZ_QUESTION_COUNT;

    const { attempt: updatedAttempt } = await prisma.$transaction((tx) =>
      dailyQuizRepository.recordAnswerAndAdvance(
        {
          attemptId: attempt.id,
          userId,
          quizDate: attempt.quizDate,
          questionId: currentQuestion.id,
          position: attempt.currentPosition,
          givenValue: normalizedGiven,
          score,
          timeMs: elapsedMs,
          isLate,
          isFinalQuestion,
          now,
          country: user?.country ?? null,
        },
        tx,
      ),
    );

    const templateKey = isLate
      ? AristotleTemplateKey.FEEDBACK_TIMEOUT
      : score >= 700
        ? AristotleTemplateKey.FEEDBACK_CORRECT
        : AristotleTemplateKey.FEEDBACK_INCORRECT;

    const aristotleFeedback = await this.renderTemplate(
      templateKey,
      {
        position: attempt.currentPosition,
        score,
        correctAnswer: currentQuestion.correctAnswer,
        numericAnswer: currentQuestion.numericAnswer ?? '',
        explanation: currentQuestion.explanation,
      },
      isLate
        ? `Time expired on question {{position}}. Score: 0. {{explanation}}`
        : `Score on question {{position}}: {{score}}/1000. {{explanation}}`,
    );

    return {
      questionId: currentQuestion.id,
      position: attempt.currentPosition,
      givenValue: normalizedGiven,
      score,
      timeMs: elapsedMs,
      isLate,
      correctAnswer: currentQuestion.correctAnswer,
      numericAnswer: currentQuestion.numericAnswer,
      explanation: currentQuestion.explanation,
      aristotleFeedback,
      isFinalQuestion,
      attempt: {
        id: updatedAttempt.id,
        totalScore: updatedAttempt.totalScore,
        totalTimeMs: updatedAttempt.totalTimeMs,
        finishedAt: updatedAttempt.finishedAt,
        nextPosition: isFinalQuestion ? null : attempt.currentPosition + 1,
      },
    };
  }

  async getDailyResult(userId: string, quizDateInput?: string, now: Date = new Date()) {
    const quizDate = quizDateInput ?? this.getServerTodayDate(now);
    const attempt = await dailyQuizRepository.findAttempt(userId, quizDate);
    if (!attempt) {
      throw new NotFoundError(`No Zugzwang attempt found for ${quizDate}`);
    }
    if (!attempt.finishedAt) {
      throw new ForbiddenError(
        'Results, answers, and explanations are revealed only after completing all 7 questions',
        'DAILY_RESULT_LOCKED',
      );
    }

    const questionById = new Map(attempt.dailyQuiz.questions.map((q) => [q.id, q]));
    const answers = attempt.answers.map((ans) => {
      const q = questionById.get(ans.questionId);
      return {
        position: ans.position,
        questionId: ans.questionId,
        type: q?.type ?? null,
        prompt: q?.prompt ?? null,
        codeSnippet: q?.codeSnippet ?? null,
        options: q?.options ?? null,
        givenValue: ans.givenValue,
        score: ans.score,
        timeMs: ans.timeMs,
        isLate: ans.isLate,
        correctAnswer: q?.correctAnswer ?? null,
        numericAnswer: q?.numericAnswer ?? null,
        explanation: q?.explanation ?? null,
      };
    });

    const aristotleSummary = await this.renderTemplate(
      AristotleTemplateKey.RESULT_SUMMARY,
      {
        quizDate,
        totalScore: attempt.totalScore,
        totalTimeMs: attempt.totalTimeMs,
        questionCount: DAILY_QUIZ_QUESTION_COUNT,
      },
      `You completed {{quizDate}} with {{totalScore}} points in {{totalTimeMs}} ms.`,
    );

    return {
      attemptId: attempt.id,
      quizDate,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      totalScore: attempt.totalScore,
      totalTimeMs: attempt.totalTimeMs,
      maxScore: DAILY_QUIZ_QUESTION_COUNT * 1000,
      aristotleSummary,
      answers,
    };
  }

  /**
   * Idempotent daily scheduler job (runs at 00:00 in DAILY_TZ):
   * 1. Marks today's quiz LIVE (using reserve fallback + admin alert if needed).
   * 2. Closes yesterday's / prior LIVE quizzes & finalizes their leaderboards.
   * 3. Tops up BUFFERED quizzes for the next DAILY_BUFFER_DAYS (default 7).
   */
  async runDailyScheduler(now: Date = new Date()) {
    const todayDate = this.getServerTodayDate(now);

    // (1) Today -> LIVE
    const todayResult = await this.ensureLiveQuizForDate(todayDate, now);

    // (2) Prior LIVE quizzes -> CLOSED + finalize leaderboard
    const staleLive = await dailyQuizRepository.findLiveQuizzesBeforeDate(todayDate);
    let closedCount = 0;
    for (const quiz of staleLive) {
      await prisma.$transaction(async (tx) => {
        await dailyQuizRepository.markQuizClosed(quiz.id, now, tx);
        await dailyQuizRepository.finalizeLeaderboardForDate(quiz.quizDate, tx);
      });
      closedCount++;
    }

    // (3) Top up buffer for next DAILY_BUFFER_DAYS
    const cutoffDateStr = addDaysToDateString(todayDate, -FINGERPRINT_WINDOW_DAYS);
    const bufferedDatesCreated: string[] = [];
    let alertsCreated = 0;

    for (let offset = 1; offset <= env.DAILY_BUFFER_DAYS; offset++) {
      const targetDate = addDaysToDateString(todayDate, offset);
      const existing = await dailyQuizRepository.findQuizByDate(targetDate);
      const approvedQuestions = (existing?.questions ?? []).filter(
        (q) => q.status === DailyQuestionStatus.APPROVED,
      );
      if (approvedQuestions.length === DAILY_QUIZ_QUESTION_COUNT) {
        continue;
      }

      const needed = DAILY_QUIZ_QUESTION_COUNT - approvedQuestions.length;
      const reserve = await dailyQuizRepository.findUnusedApprovedReserveQuestions(
        cutoffDateStr,
        needed,
      );

      if (reserve.length < needed) {
        const created = await this.createAlertIfNoneOpen({
          type: 'BUFFER_LOW',
          quizDate: targetDate,
          message: `Cannot buffer ${targetDate}: only ${reserve.length}/${needed} unused approved reserve questions remain.`,
        });
        if (created) alertsCreated++;
        continue;
      }

      const usedPositions = new Set(
        approvedQuestions.map((q) => q.position).filter((p): p is number => p !== null),
      );
      const openPositions: number[] = [];
      for (let pos = 1; pos <= DAILY_QUIZ_QUESTION_COUNT; pos++) {
        if (!usedPositions.has(pos)) {
          openPositions.push(pos);
        }
      }

      await prisma.$transaction(async (tx) => {
        const targetQuiz = await dailyQuizRepository.createOrGetQuizForDate(
          targetDate,
          DailyQuizStatus.BUFFERED,
          tx,
        );
        for (let i = 0; i < reserve.length; i++) {
          await tx.dailyQuestion.update({
            where: { id: reserve[i].id },
            data: {
              dailyQuizId: targetQuiz.id,
              position: openPositions[i],
              lastUsedDate: targetDate,
              isReserve: false,
            },
          });
        }
      });
      bufferedDatesCreated.push(targetDate);
    }

    return {
      todayDate,
      todayUsedReserveFallback: todayResult.usedReserveFallback,
      closedCount,
      bufferedDatesCreated,
      alertsCreated,
    };
  }

  // ==========================================
  // Question Generation Pipeline & Admin Ops
  // ==========================================

  async submitQuestionCandidate(
    actorUserId: string,
    input: {
      type: DailyQuestionType;
      prompt: string;
      codeSnippet?: string | null;
      spokenText?: string | null;
      options?: string[] | null;
      correctAnswer: string;
      numericAnswer?: number | null;
      scale?: number | null;
      explanation: string;
      sourceUrl?: string | null;
      license?: string | null;
      generatedBy: DailyQuestionOrigin;
      isReserve?: boolean;
      dailyQuizId?: string | null;
      position?: number | null;
      isFactualClaim?: boolean;
      isCodeOutput?: boolean;
    },
    now: Date = new Date(),
  ) {
    const { normalizedCorrectAnswer } = validateDailyQuestionCandidatePayload(input);

    const fingerprint = computePromptFingerprint(input.prompt);
    const sinceDate = new Date(now.getTime() - FINGERPRINT_WINDOW_DAYS * 86_400_000);
    const duplicate = await dailyQuizRepository.findRecentFingerprintMatch(fingerprint, sinceDate);
    if (duplicate) {
      throw new ConflictError(
        `A question with this prompt fingerprint already exists within the last ${FINGERPRINT_WINDOW_DAYS} days`,
        'DUPLICATE_FINGERPRINT',
      );
    }

    // AI-generated candidates ALWAYS start as DRAFT (never auto-approved).
    // Human candidates also start in DRAFT and enter the admin review queue.
    const status = DailyQuestionStatus.DRAFT;

    const question = await dailyQuizRepository.createQuestion({
      dailyQuizId: input.dailyQuizId ?? null,
      position: input.position ?? null,
      type: input.type,
      prompt: input.prompt.trim(),
      codeSnippet: input.codeSnippet ?? null,
      spokenText: input.spokenText ?? null,
      options: input.options ? input.options : Prisma.JsonNull,
      correctAnswer: normalizedCorrectAnswer,
      numericAnswer:
        input.type === DailyQuestionType.ESTIMATE ? (input.numericAnswer ?? null) : null,
      scale: input.type === DailyQuestionType.ESTIMATE ? (input.scale ?? null) : null,
      explanation: input.explanation.trim(),
      sourceUrl: input.sourceUrl ?? null,
      license: input.license ?? null,
      status,
      generatedBy: input.generatedBy,
      fingerprint,
      isReserve: input.dailyQuizId ? false : (input.isReserve ?? true),
      createdById: actorUserId,
    });

    await auditLogRepository.create({
      actorUserId,
      entityType: 'DailyQuestion',
      entityId: question.id,
      action: 'CANDIDATE_SUBMITTED',
      changes: {
        generatedBy: question.generatedBy,
        status: question.status,
        fingerprint: question.fingerprint,
      },
    });

    return question;
  }

  async reviewQuestion(
    adminUserId: string,
    questionId: string,
    input: { decision: 'APPROVED' | 'REJECTED'; reason: string },
    now: Date = new Date(),
  ) {
    const existing = await dailyQuizRepository.findQuestionById(questionId);
    if (!existing) {
      throw new NotFoundError('Daily question not found');
    }

    const nextStatus =
      input.decision === 'APPROVED'
        ? DailyQuestionStatus.APPROVED
        : DailyQuestionStatus.REJECTED;

    return prisma.$transaction(async (tx) => {
      const updated = await dailyQuizRepository.updateQuestionReview(
        questionId,
        {
          status: nextStatus,
          rejectionReason: nextStatus === DailyQuestionStatus.REJECTED ? input.reason : null,
          reviewedById: adminUserId,
          reviewedAt: now,
        },
        tx,
      );

      await auditLogRepository.create(
        {
          actorUserId: adminUserId,
          entityType: 'DailyQuestion',
          entityId: questionId,
          action: `REVIEW_${nextStatus}`,
          reason: input.reason,
          changes: {
            fromStatus: existing.status,
            toStatus: nextStatus,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async listQuestions(filters: {
    status?: DailyQuestionStatus;
    isReserve?: boolean;
    dailyQuizId?: string;
  }) {
    return dailyQuizRepository.listQuestions(filters);
  }

  async getBufferOverview(now: Date = new Date()) {
    const todayDate = this.getServerTodayDate(now);
    const dates: string[] = [];
    for (let i = 0; i <= env.DAILY_BUFFER_DAYS; i++) {
      dates.push(addDaysToDateString(todayDate, i));
    }

    const quizzes = await dailyQuizRepository.findQuizzesInDateRange(dates);
    const quizMap = new Map(quizzes.map((q) => [q.quizDate, q]));
    const cutoffDateStr = addDaysToDateString(todayDate, -FINGERPRINT_WINDOW_DAYS);
    const availableReserve = await dailyQuizRepository.findUnusedApprovedReserveQuestions(
      cutoffDateStr,
      1000,
    );

    const days = dates.map((quizDate) => {
      const q = quizMap.get(quizDate);
      const approvedCount = (q?.questions ?? []).filter(
        (item) => item.status === DailyQuestionStatus.APPROVED,
      ).length;
      return {
        quizDate,
        status: q?.status ?? null,
        totalQuestions: q?.questions.length ?? 0,
        approvedCount,
        publishable: approvedCount === DAILY_QUIZ_QUESTION_COUNT,
        usedReserveFallback: q?.usedReserveFallback ?? false,
      };
    });

    return {
      todayDate,
      dailyTz: env.DAILY_TZ,
      bufferDaysConfigured: env.DAILY_BUFFER_DAYS,
      availableReserveCount: availableReserve.length,
      days,
    };
  }

  async listReservePool(now: Date = new Date()) {
    const todayDate = this.getServerTodayDate(now);
    const cutoffDateStr = addDaysToDateString(todayDate, -FINGERPRINT_WINDOW_DAYS);
    const unusedEligible = await dailyQuizRepository.findUnusedApprovedReserveQuestions(
      cutoffDateStr,
      500,
    );
    const allReserve = await dailyQuizRepository.listQuestions({ isReserve: true });
    return {
      cutoffDateStr,
      unusedEligibleCount: unusedEligible.length,
      unusedEligible,
      allReserve,
    };
  }

  async manualPublishQuiz(adminUserId: string, quizDate: string, now: Date = new Date()) {
    const quiz = await dailyQuizRepository.findQuizByDate(quizDate);
    if (!quiz) {
      throw new NotFoundError(`No Zugzwang quiz exists for ${quizDate}`);
    }
    const approvedCount = quiz.questions.filter(
      (q) => q.status === DailyQuestionStatus.APPROVED,
    ).length;
    if (approvedCount !== DAILY_QUIZ_QUESTION_COUNT) {
      throw new BadRequestError(
        `Quiz for ${quizDate} cannot be published: requires ${DAILY_QUIZ_QUESTION_COUNT} APPROVED questions, currently has ${approvedCount}`,
        'QUIZ_NOT_PUBLISHABLE',
      );
    }

    const published = await prisma.$transaction(async (tx) => {
      const updated = await dailyQuizRepository.markQuizLive(quiz.id, quiz.usedReserveFallback, now, tx);
      await auditLogRepository.create(
        {
          actorUserId: adminUserId,
          entityType: 'DailyQuiz',
          entityId: quiz.id,
          action: 'MANUAL_PUBLISH',
          changes: { quizDate, status: DailyQuizStatus.LIVE },
        },
        tx,
      );
      return updated;
    });

    return published;
  }

  async listAristotleTemplates() {
    return dailyQuizRepository.listAristotleTemplates();
  }

  async upsertAristotleTemplate(
    adminUserId: string,
    key: AristotleTemplateKey,
    input: { title: string; body: string; language?: string; voiceId?: string },
  ) {
    const template = await dailyQuizRepository.upsertAristotleTemplate({
      key,
      title: input.title,
      body: input.body,
      language: input.language ?? env.TTS_DEFAULT_LANGUAGE,
      voiceId: input.voiceId ?? 'aristotle',
      updatedById: adminUserId,
    });

    const voiceAsset = await voiceService.queueVoiceForAristotleTemplate(template);

    await auditLogRepository.create({
      actorUserId: adminUserId,
      entityType: 'AristotleTemplate',
      entityId: template.id,
      action: 'TEMPLATE_UPSERT',
      changes: { key, language: template.language, voiceId: template.voiceId },
    });

    return { template, voiceAsset };
  }

  async listOpenAlerts() {
    return dailyQuizRepository.listOpenAlerts();
  }

  async resolveAlert(id: string) {
    return dailyQuizRepository.resolveAlert(id);
  }
}

export const dailyQuizService = new DailyQuizService();
