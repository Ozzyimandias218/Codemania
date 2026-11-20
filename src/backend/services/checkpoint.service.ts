import { QuestionOrigin, QuestionStatus } from '@prisma/client';
import { questionRepository } from '../repositories/question.repository.ts';
import { reviewQueueRepository } from '../repositories/reviewQueue.repository.ts';
import { BadRequestError } from '../utils/errors.ts';
import { shuffleArray } from '../utils/shuffle.ts';

export interface CheckpointCandidateQuestion {
  id: string;
  levelId: string;
  levelNumber: number;
  unitId: string;
  origin: QuestionOrigin;
  status: QuestionStatus;
}

export interface CheckpointSelectionInput<
  T extends CheckpointCandidateQuestion = CheckpointCandidateQuestion,
> {
  authoredPool: T[];
  webPool: T[];
  reviewQueueQuestionIds: Set<string>;
  maxAuthored?: number;
  maxWeb?: number;
  rng?: () => number;
}

/**
 * Pure checkpoint question selection algorithm (Section 4):
 * - Pool: approved authored questions from all earlier LESSON levels of the same track.
 * - Select max 20:
 *    - at least 1 from every unit reached
 *    - 60% from the last 4 lessons
 *    - the rest from older lessons, preferring review-queue questions
 * - Add up to 5 approved WEB-origin questions.
 * - Shuffle. Never DRAFT or REJECTED.
 */
export function selectCheckpointQuestions<T extends CheckpointCandidateQuestion>(
  input: CheckpointSelectionInput<T>,
): T[] {
  const maxAuthored = input.maxAuthored ?? 20;
  const maxWeb = input.maxWeb ?? 5;
  const rng = input.rng ?? Math.random;

  // Hard safety filter: NEVER DRAFT or REJECTED
  const approvedAuthored = input.authoredPool.filter(
    (q) => q.status === QuestionStatus.APPROVED && q.origin === QuestionOrigin.AUTHORED,
  );
  const approvedWeb = input.webPool.filter(
    (q) => q.status === QuestionStatus.APPROVED && q.origin === QuestionOrigin.WEB,
  );

  if (approvedAuthored.length === 0 && approvedWeb.length === 0) {
    return [];
  }

  // Determine distinct lesson numbers sorted ascending -> last 4 lessons
  const distinctLessons = Array.from(new Set(approvedAuthored.map((q) => q.levelNumber))).sort(
    (a, b) => a - b,
  );
  const last4LessonNumbers = new Set(distinctLessons.slice(-4));

  const selectedIds = new Set<string>();
  const selectedAuthored: T[] = [];

  const pick = (q: T) => {
    if (selectedIds.has(q.id) || selectedAuthored.length >= maxAuthored) return false;
    selectedIds.add(q.id);
    selectedAuthored.push(q);
    return true;
  };

  // 1. Guarantee at least 1 from every unit reached (if possible within maxAuthored)
  const unitGroups = new Map<string, T[]>();
  for (const q of approvedAuthored) {
    const list = unitGroups.get(q.unitId) ?? [];
    list.push(q);
    unitGroups.set(q.unitId, list);
  }

  for (const [, unitQuestions] of unitGroups) {
    if (selectedAuthored.length >= maxAuthored) break;
    // Prefer review-queue or last-4 when picking unit representative
    const sorted = [...shuffleArray(unitQuestions, rng)].sort((a, b) => {
      const aRev = input.reviewQueueQuestionIds.has(a.id) ? 1 : 0;
      const bRev = input.reviewQueueQuestionIds.has(b.id) ? 1 : 0;
      if (aRev !== bRev) return bRev - aRev;
      const aLast4 = last4LessonNumbers.has(a.levelNumber) ? 1 : 0;
      const bLast4 = last4LessonNumbers.has(b.levelNumber) ? 1 : 0;
      return bLast4 - aLast4;
    });
    if (sorted[0]) {
      pick(sorted[0]);
    }
  }

  // 2. Target 60% from the last 4 lessons
  const targetTotalAuthored = Math.min(maxAuthored, approvedAuthored.length);
  const targetLast4Count = Math.round(targetTotalAuthored * 0.6);
  let currentLast4Count = selectedAuthored.filter((q) =>
    last4LessonNumbers.has(q.levelNumber),
  ).length;

  const last4Pool = shuffleArray(
    approvedAuthored.filter((q) => last4LessonNumbers.has(q.levelNumber) && !selectedIds.has(q.id)),
    rng,
  );

  for (const q of last4Pool) {
    if (currentLast4Count >= targetLast4Count || selectedAuthored.length >= targetTotalAuthored) {
      break;
    }
    if (pick(q)) {
      currentLast4Count++;
    }
  }

  // 3. Fill the rest from older lessons, preferring review-queue questions
  const olderPool = approvedAuthored.filter(
    (q) => !last4LessonNumbers.has(q.levelNumber) && !selectedIds.has(q.id),
  );
  const olderReview = shuffleArray(
    olderPool.filter((q) => input.reviewQueueQuestionIds.has(q.id)),
    rng,
  );
  const olderNonReview = shuffleArray(
    olderPool.filter((q) => !input.reviewQueueQuestionIds.has(q.id)),
    rng,
  );

  for (const q of [...olderReview, ...olderNonReview]) {
    if (selectedAuthored.length >= targetTotalAuthored) break;
    pick(q);
  }

  // 4. If still short (e.g. fewer older questions exist), top up from remaining last-4 questions
  if (selectedAuthored.length < targetTotalAuthored) {
    for (const q of last4Pool) {
      if (selectedAuthored.length >= targetTotalAuthored) break;
      pick(q);
    }
  }

  // 5. Add up to 5 approved WEB-origin questions
  const selectedWeb = shuffleArray(approvedWeb, rng).slice(0, maxWeb);

  // 6. Shuffle combined checkpoint question list
  return shuffleArray([...selectedAuthored, ...selectedWeb], rng);
}

export class CheckpointService {
  async generateCheckpointQuestions(params: {
    userId: string;
    trackId: string;
    checkpointLevelNumber: number;
  }) {
    const [allEarlierApproved, reviewQueueIds] = await Promise.all([
      questionRepository.findApprovedEarlierInTrack({
        trackId: params.trackId,
        beforeLevelNumber: params.checkpointLevelNumber,
      }),
      reviewQueueRepository.findAllQuestionIdsInUserQueue(params.userId),
    ]);

    const mapped = allEarlierApproved.map((q) => ({
      ...q,
      levelNumber: q.level.number,
      unitId: q.level.unitId,
    }));

    const authoredPool = mapped.filter((q) => q.origin === QuestionOrigin.AUTHORED);
    const webPool = mapped.filter((q) => q.origin === QuestionOrigin.WEB);

    const selected = selectCheckpointQuestions({
      authoredPool,
      webPool,
      reviewQueueQuestionIds: reviewQueueIds,
    });

    if (selected.length === 0) {
      throw new BadRequestError('No approved questions available to generate checkpoint');
    }

    return selected;
  }
}

export const checkpointService = new CheckpointService();
