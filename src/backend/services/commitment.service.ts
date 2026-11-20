import {
  CommitmentMode,
  CommitmentStatus,
  FinalSubmissionStatus,
  FinalSubmissionType,
  MissedDayMode,
  PenaltyType,
} from '@prisma/client';
import { env } from '../config/env.ts';
import { commitmentRepository } from '../repositories/commitment.repository.ts';
import { questionRepository } from '../repositories/question.repository.ts';
import { trackRepository } from '../repositories/track.repository.ts';
import { userRepository } from '../repositories/user.repository.ts';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnprocessableError,
} from '../utils/errors.ts';
import { shuffleArray } from '../utils/shuffle.ts';
import {
  addDaysToDateString,
  diffCalendarDays,
  formatDateInTimezone,
  isValidTimezone,
  listCalendarDaysInclusive,
} from '../utils/timezone.ts';
import { stripeService } from './stripe.service.ts';
import { sanitizePublicQuestion } from './track.service.ts';

export const FINAL_EXAM_PASS_MARK = 0.6;
export const MAX_FINAL_EXAM_ATTEMPTS = 2;

export function calculateRequiredLevelsPerDay(
  remainingLevels: number,
  durationDays: number,
): number {
  if (durationDays <= 0) {
    throw new BadRequestError('durationDays must be greater than 0');
  }
  const safeRemaining = Math.max(0, remainingLevels);
  return Number((safeRemaining / durationDays).toFixed(4));
}

export function evaluatePaceRequirement(params: {
  remainingLevels: number;
  durationDays: number;
  maxLevelsPerDay: number;
  acknowledgePace: boolean;
}): { requiredLevelsPerDay: number; exceedsRecommendedPace: boolean } {
  const requiredLevelsPerDay = calculateRequiredLevelsPerDay(
    params.remainingLevels,
    params.durationDays,
  );
  const exceedsRecommendedPace = requiredLevelsPerDay > params.maxLevelsPerDay;
  if (exceedsRecommendedPace && !params.acknowledgePace) {
    throw new UnprocessableError(
      `Pace ${requiredLevelsPerDay} levels/day exceeds MAX_LEVELS_PER_DAY (${params.maxLevelsPerDay}). Set acknowledgePace: true to confirm.`,
      'PACE_CONFIRMATION_REQUIRED',
      {
        requiredLevelsPerDay,
        maxLevelsPerDay: params.maxLevelsPerDay,
      },
    );
  }
  return { requiredLevelsPerDay, exceedsRecommendedPace };
}

export function applyPenaltyCap(params: {
  existingActivePenaltiesCents: number;
  proposedPenaltyCents: number;
  maxTotalPenaltyCents: number;
}): number {
  const remainingCap = Math.max(0, params.maxTotalPenaltyCents - params.existingActivePenaltiesCents);
  return Math.min(Math.max(0, params.proposedPenaltyCents), remainingCap);
}

export interface MissedDayEvaluationInput {
  startDate: Date;
  durationDays: number;
  timezone: string;
  missedDayMode: MissedDayMode;
  excusedDaysAllowed: number;
  dailyPenaltyCents: number;
  finalFailPenaltyCents: number;
  maxTotalPenaltyCents: number;
  passedLevelDatesInTz: Set<string>;
  finalPassedAt: Date | null;
  now: Date;
  existingPenalties: Array<{
    type: PenaltyType;
    date: string;
    amountCents: number;
    voidedAt: Date | null;
  }>;
}

export interface ProposedPenaltyEntry {
  type: PenaltyType;
  date: string;
  amountCents: number;
}

/**
 * Pure commitment penalty evaluator (Section 6):
 * - INACTIVE_DAYS: a completed day in the contract window with 0 passed levels is missed,
 *   using up to `excusedDaysAllowed` first.
 * - LATE_DAYS: each completed day after deadline + 24h grace before final is passed is missed.
 * - FINAL_FAIL: if final is not passed by deadline + 24h grace, at most ONE FINAL_FAIL penalty.
 * - Total active penalties strictly capped at maxTotalPenaltyCents.
 * - Idempotent via (type, date) keys.
 */
export function computeNewPenaltiesForCommitment(
  input: MissedDayEvaluationInput,
): {
  newPenalties: ProposedPenaltyEntry[];
  contractWindowEndedWithGrace: boolean;
} {
  const startDateStr = formatDateInTimezone(input.startDate, input.timezone);
  const endDateStr = addDaysToDateString(startDateStr, input.durationDays - 1);
  const todayStr = formatDateInTimezone(input.now, input.timezone);

  // Deadline = startDate + durationDays; +24h grace = deadlineMs + 24h
  const deadlineMs = input.startDate.getTime() + input.durationDays * 86_400_000;
  const graceEndMs = deadlineMs + 24 * 60 * 60 * 1000;
  const pastGrace = input.now.getTime() > graceEndMs;

  const existingKeys = new Set(input.existingPenalties.map((p) => `${p.type}:${p.date}`));
  let runningTotalCents = input.existingPenalties
    .filter((p) => p.voidedAt === null)
    .reduce((sum, p) => sum + p.amountCents, 0);

  const newPenalties: ProposedPenaltyEntry[] = [];

  const pushCapped = (type: PenaltyType, date: string, rawAmount: number) => {
    const key = `${type}:${date}`;
    if (existingKeys.has(key)) return;
    const capped = applyPenaltyCap({
      existingActivePenaltiesCents: runningTotalCents,
      proposedPenaltyCents: rawAmount,
      maxTotalPenaltyCents: input.maxTotalPenaltyCents,
    });
    if (capped <= 0) return;
    existingKeys.add(key);
    runningTotalCents += capped;
    newPenalties.push({ type, date, amountCents: capped });
  };

  if (input.missedDayMode === MissedDayMode.INACTIVE_DAYS) {
    // Only evaluate completed calendar days strictly before today, up to endDateStr
    const yesterdayStr = addDaysToDateString(todayStr, -1);
    const evalEndStr =
      diffCalendarDays(endDateStr, yesterdayStr) >= 0 ? endDateStr : yesterdayStr;

    const completedWindowDays = listCalendarDaysInclusive(startDateStr, evalEndStr);
    const missedDays = completedWindowDays.filter((d) => !input.passedLevelDatesInTz.has(d));

    // Use up to excusedDaysAllowed first
    const unexcusedDays = missedDays.slice(Math.max(0, input.excusedDaysAllowed));
    for (const dayStr of unexcusedDays) {
      pushCapped(PenaltyType.DAILY_MISSED, dayStr, input.dailyPenaltyCents);
    }
  } else if (input.missedDayMode === MissedDayMode.LATE_DAYS) {
    // Late days start after deadline + 24h grace until final is passed (or today)
    if (pastGrace) {
      const graceEndDateStr = formatDateInTimezone(new Date(graceEndMs), input.timezone);
      const stopInstant = input.finalPassedAt ?? input.now;
      const stopDateStr = formatDateInTimezone(stopInstant, input.timezone);
      const yesterdayStop = addDaysToDateString(stopDateStr, -1);

      // Count completed days strictly after graceEndDateStr up to yesterday of stop/today
      const lateStartStr = addDaysToDateString(graceEndDateStr, 1);
      const lateDays = listCalendarDaysInclusive(lateStartStr, yesterdayStop);
      for (const dayStr of lateDays) {
        pushCapped(PenaltyType.LATE_DAY, dayStr, input.dailyPenaltyCents);
      }
    }
  }

  // Final fail check: if not passed by deadline + 24h grace -> one FINAL_FAIL penalty
  if (pastGrace) {
    const passedBeforeGraceEnd =
      input.finalPassedAt !== null && input.finalPassedAt.getTime() <= graceEndMs;
    if (!passedBeforeGraceEnd) {
      pushCapped(PenaltyType.FINAL_FAIL, 'FINAL', input.finalFailPenaltyCents);
    }
  }

  return {
    newPenalties,
    contractWindowEndedWithGrace: pastGrace,
  };
}

export class CommitmentService {
  async createCommitment(
    userId: string,
    input: {
      trackId: string;
      startDate?: string;
      durationDays: number;
      timezone?: string;
      mode: CommitmentMode;
      missedDayMode: MissedDayMode;
      dailyPenaltyCents?: number;
      finalFailPenaltyCents: number;
      depositCents?: number;
      maxTotalPenaltyCents: number;
      excusedDaysAllowed?: number;
      currency?: string;
      termsVersion: string;
      acknowledgePace?: boolean;
    },
  ) {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found');

    if (!user.isAdult) {
      throw new ForbiddenError(
        'Only users who confirmed they are adults (isAdult = true) can create commitment contracts',
        'ADULT_REQUIRED',
      );
    }

    const track = await trackRepository.findById(input.trackId);
    if (!track) throw new NotFoundError('Track not found');

    const timezone = input.timezone ?? user.timezone ?? 'UTC';
    if (!isValidTimezone(timezone)) {
      throw new BadRequestError(`Invalid timezone: ${timezone}`);
    }

    if (input.mode === CommitmentMode.DEPOSIT_REFUND && (!input.depositCents || input.depositCents <= 0)) {
      throw new BadRequestError('depositCents is required and must be positive in DEPOSIT_REFUND mode');
    }

    if (input.mode !== CommitmentMode.SIMULATED && !env.STRIPE_SECRET_KEY) {
      throw new BadRequestError(
        'Stripe is not configured; only SIMULATED mode is available without STRIPE_SECRET_KEY',
        'STRIPE_NOT_CONFIGURED',
      );
    }

    const passedProgress = await trackRepository.findUserLevelProgress(userId, track.id);
    const remainingLevels = Math.max(0, track.levelCount - passedProgress.length);

    const { requiredLevelsPerDay, exceedsRecommendedPace } = evaluatePaceRequirement({
      remainingLevels,
      durationDays: input.durationDays,
      maxLevelsPerDay: env.MAX_LEVELS_PER_DAY,
      acknowledgePace: Boolean(input.acknowledgePace),
    });

    const startDate = input.startDate ? new Date(input.startDate) : new Date();
    const initialStatus =
      input.mode === CommitmentMode.SIMULATED
        ? CommitmentStatus.ACTIVE
        : CommitmentStatus.PENDING_PAYMENT_METHOD;

    const commitment = await commitmentRepository.create({
      userId,
      trackId: track.id,
      startDate,
      durationDays: input.durationDays,
      timezone,
      mode: input.mode,
      missedDayMode: input.missedDayMode,
      dailyPenaltyCents: input.dailyPenaltyCents ?? 100,
      finalFailPenaltyCents: input.finalFailPenaltyCents,
      depositCents: input.depositCents ?? null,
      maxTotalPenaltyCents: input.maxTotalPenaltyCents,
      excusedDaysAllowed: input.excusedDaysAllowed ?? 2,
      currency: (input.currency ?? 'usd').toLowerCase(),
      status: initialStatus,
      termsVersion: input.termsVersion,
      termsAcceptedAt: new Date(),
      requiredLevelsPerDay,
      stripeCustomerId: user.stripeCustomerId,
    });

    let stripeCheckoutUrl: string | null = null;
    if (input.mode !== CommitmentMode.SIMULATED) {
      const session = await stripeService.createSetupSessionForCommitment({
        userId: user.id,
        email: user.email,
        existingStripeCustomerId: user.stripeCustomerId,
        commitmentId: commitment.id,
        mode: input.mode,
      });
      stripeCheckoutUrl = session.checkoutUrl;
    }

    return {
      commitment,
      requiredLevelsPerDay,
      exceedsRecommendedPace,
      remainingLevels,
      stripeCheckoutUrl,
    };
  }

  async getCommitment(userId: string, commitmentId: string) {
    const commitment = await commitmentRepository.findById(commitmentId);
    if (!commitment || commitment.userId !== userId) {
      throw new NotFoundError('Commitment not found');
    }

    const activePenaltiesCents = commitment.penalties
      .filter((p) => p.voidedAt === null)
      .reduce((sum, p) => sum + p.amountCents, 0);

    return {
      ...commitment,
      totalActivePenaltyCents: Math.min(commitment.maxTotalPenaltyCents, activePenaltiesCents),
      suggestedDepositRefundCents:
        commitment.mode === CommitmentMode.DEPOSIT_REFUND && commitment.depositCents != null
          ? Math.max(0, commitment.depositCents - Math.min(commitment.maxTotalPenaltyCents, activePenaltiesCents))
          : null,
    };
  }

  async listMyCommitments(userId: string) {
    return commitmentRepository.findByUser(userId);
  }

  async startFinalExam(userId: string, commitmentId: string) {
    const commitment = await commitmentRepository.findById(commitmentId);
    if (!commitment || commitment.userId !== userId) {
      throw new NotFoundError('Commitment not found');
    }
    if (commitment.status !== CommitmentStatus.ACTIVE && commitment.status !== CommitmentStatus.PENALTY_DUE) {
      throw new ConflictError(`Cannot start final exam when commitment is ${commitment.status}`);
    }
    if (commitment.finalPassedAt) {
      throw new ConflictError('Final requirement is already passed');
    }

    const existingAttempts = await commitmentRepository.countExamAttempts(commitment.id);
    if (existingAttempts >= MAX_FINAL_EXAM_ATTEMPTS) {
      throw new ForbiddenError(`Maximum of ${MAX_FINAL_EXAM_ATTEMPTS} final exam attempts reached`, 'MAX_ATTEMPTS_REACHED');
    }

    const pool = await questionRepository.findApprovedByTrackForFinalExam(commitment.trackId);
    if (pool.length === 0) {
      throw new BadRequestError('No approved questions available for final exam');
    }

    const selected = shuffleArray(pool).slice(0, env.FINAL_EXAM_QUESTION_COUNT);
    const startedAt = new Date();
    const expiresAt = new Date(
      startedAt.getTime() + env.FINAL_EXAM_TIME_LIMIT_MINUTES * 60_000,
    );

    const submission = await commitmentRepository.createFinalSubmission({
      commitmentId: commitment.id,
      userId,
      type: FinalSubmissionType.EXAM,
      status: FinalSubmissionStatus.SUBMITTED,
      attemptNumber: existingAttempts + 1,
      questionIds: selected.map((q) => q.id),
      startedAt,
      expiresAt,
    });

    return {
      submissionId: submission.id,
      attemptNumber: submission.attemptNumber,
      startedAt,
      expiresAt,
      timeLimitMinutes: env.FINAL_EXAM_TIME_LIMIT_MINUTES,
      passMark: FINAL_EXAM_PASS_MARK,
      questions: selected.map(sanitizePublicQuestion),
    };
  }

  async submitFinal(
    userId: string,
    commitmentId: string,
    input:
      | {
          type: 'EXAM';
          submissionId: string;
          answers: Array<{ questionId: string; answer: string }>;
        }
      | {
          type: 'PROJECT';
          projectUrl: string;
          projectNotes?: string;
        },
  ) {
    const commitment = await commitmentRepository.findById(commitmentId);
    if (!commitment || commitment.userId !== userId) {
      throw new NotFoundError('Commitment not found');
    }

    const now = new Date();

    if (input.type === 'PROJECT') {
      const submission = await commitmentRepository.createFinalSubmission({
        commitmentId: commitment.id,
        userId,
        type: FinalSubmissionType.PROJECT,
        status: FinalSubmissionStatus.SUBMITTED,
        attemptNumber: 1,
        projectUrl: input.projectUrl,
        projectNotes: input.projectNotes,
        submittedAt: now,
      });
      return submission;
    }

    const submission = await commitmentRepository.findFinalSubmissionById(input.submissionId);
    if (!submission || submission.commitmentId !== commitment.id || submission.userId !== userId) {
      throw new NotFoundError('Final exam submission not found');
    }
    if (submission.type !== FinalSubmissionType.EXAM) {
      throw new BadRequestError('Submission is not an EXAM');
    }
    if (submission.submittedAt) {
      throw new ConflictError('Final exam already submitted');
    }
    if (submission.expiresAt && now > submission.expiresAt) {
      await commitmentRepository.updateFinalSubmission(submission.id, {
        status: FinalSubmissionStatus.REJECTED,
        submittedAt: now,
        scorePct: 0,
        reviewNotes: 'Time limit exceeded',
      });
      throw new ForbiddenError('Final exam time limit exceeded', 'EXAM_EXPIRED');
    }

    const expectedIds = (submission.questionIds as string[] | null) ?? [];
    const questions = await questionRepository.findManyByIds(expectedIds);
    const qMap = new Map(questions.map((q) => [q.id, q]));
    const aMap = new Map(input.answers.map((a) => [a.questionId, a.answer.trim()]));

    let correct = 0;
    for (const qId of expectedIds) {
      const q = qMap.get(qId);
      if (q && aMap.get(qId) === q.answer.trim()) {
        correct++;
      }
    }

    const scorePct = expectedIds.length > 0 ? correct / expectedIds.length : 0;
    const passed = scorePct >= FINAL_EXAM_PASS_MARK;

    const updated = await commitmentRepository.updateFinalSubmission(submission.id, {
      answers: input.answers,
      scorePct,
      submittedAt: now,
      status: passed ? FinalSubmissionStatus.APPROVED : FinalSubmissionStatus.REJECTED,
    });

    if (passed && !commitment.finalPassedAt) {
      await commitmentRepository.update(commitment.id, {
        finalPassedAt: now,
      });
    }

    return {
      ...updated,
      passed,
      correctCount: correct,
      totalQuestions: expectedIds.length,
    };
  }

  async createAppeal(
    userId: string,
    commitmentId: string,
    input: { finalSubmissionId?: string; reason: string },
  ) {
    const commitment = await commitmentRepository.findById(commitmentId);
    if (!commitment || commitment.userId !== userId) {
      throw new NotFoundError('Commitment not found');
    }

    if (input.finalSubmissionId) {
      const sub = await commitmentRepository.findFinalSubmissionById(input.finalSubmissionId);
      if (!sub || sub.commitmentId !== commitment.id) {
        throw new NotFoundError('Final submission not found for this commitment');
      }
    }

    return commitmentRepository.createAppeal({
      commitmentId: commitment.id,
      userId,
      finalSubmissionId: input.finalSubmissionId,
      reason: input.reason,
    });
  }

  /**
   * Daily evaluation job: computes penalties idempotently for active commitments
   * and triggers close-out when contract + grace window finishes.
   */
  async evaluateAllActiveCommitments(now: Date = new Date()): Promise<{ evaluated: number }> {
    const commitments = await commitmentRepository.findActiveOrDueCommitments();
    for (const c of commitments) {
      await this.evaluateCommitmentById(c.id, now);
    }
    return { evaluated: commitments.length };
  }

  async evaluateCommitmentById(commitmentId: string, now: Date = new Date()) {
    const c = await commitmentRepository.findById(commitmentId);
    if (!c || (c.status !== CommitmentStatus.ACTIVE && c.status !== CommitmentStatus.PENALTY_DUE)) {
      return null;
    }

    const windowEndForQuery = new Date(
      Math.max(now.getTime(), c.startDate.getTime() + c.durationDays * 86_400_000),
    );
    const passedRows = await trackRepository.countNonPlacementPassedLevelsInWindow(
      c.userId,
      c.trackId,
      c.startDate,
      windowEndForQuery,
    );

    const passedDates = new Set(
      passedRows.map((r) => formatDateInTimezone(r.passedAt, c.timezone)),
    );

    const { newPenalties, contractWindowEndedWithGrace } = computeNewPenaltiesForCommitment({
      startDate: c.startDate,
      durationDays: c.durationDays,
      timezone: c.timezone,
      missedDayMode: c.missedDayMode,
      excusedDaysAllowed: c.excusedDaysAllowed,
      dailyPenaltyCents: c.dailyPenaltyCents,
      finalFailPenaltyCents: c.finalFailPenaltyCents,
      maxTotalPenaltyCents: c.maxTotalPenaltyCents,
      passedLevelDatesInTz: passedDates,
      finalPassedAt: c.finalPassedAt,
      now,
      existingPenalties: c.penalties,
    });

    for (const entry of newPenalties) {
      await commitmentRepository.createPenaltyIdempotent({
        commitmentId: c.id,
        type: entry.type,
        date: entry.date,
        amountCents: entry.amountCents,
      });
    }

    if (contractWindowEndedWithGrace && c.status === CommitmentStatus.ACTIVE) {
      const refreshed = await commitmentRepository.findById(c.id);
      if (!refreshed) return null;

      const totalPenalty = refreshed.penalties
        .filter((p) => p.voidedAt === null)
        .reduce((sum, p) => sum + p.amountCents, 0);

      if (refreshed.mode === CommitmentMode.SIMULATED) {
        await commitmentRepository.update(refreshed.id, {
          status:
            refreshed.finalPassedAt && totalPenalty === 0
              ? CommitmentStatus.COMPLETED
              : CommitmentStatus.CLOSED,
          closedAt: now,
        });
      } else if (!refreshed.hasActiveAppeal) {
        if (refreshed.mode === CommitmentMode.PENALTY && totalPenalty > 0) {
          await stripeService.chargeClosePenaltyOnce(refreshed.id);
        } else {
          await commitmentRepository.update(refreshed.id, {
            status:
              refreshed.finalPassedAt && totalPenalty === 0
                ? CommitmentStatus.COMPLETED
                : CommitmentStatus.CLOSED,
            closedAt: now,
          });
        }
      }
    }

    return { newPenaltiesCount: newPenalties.length, contractWindowEndedWithGrace };
  }
}

export const commitmentService = new CommitmentService();
