import { QuestionOrigin, QuestionStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  CheckpointCandidateQuestion,
  selectCheckpointQuestions,
} from '../src/backend/services/checkpoint.service.ts';

function makeQuestion(
  id: string,
  levelNumber: number,
  unitId: string,
  origin: QuestionOrigin = QuestionOrigin.AUTHORED,
  status: QuestionStatus = QuestionStatus.APPROVED,
): CheckpointCandidateQuestion {
  return {
    id,
    levelId: `lvl-${levelNumber}`,
    levelNumber,
    unitId,
    origin,
    status,
  };
}

describe('Checkpoint selection', () => {
  it('selects max 20 authored + up to 5 WEB, includes >=1 per unit, 60% from last 4 lessons, prefers review queue, and excludes DRAFT/REJECTED', () => {
    const authoredPool: CheckpointCandidateQuestion[] = [];
    // Units 1..3, lessons 1..14 (excluding checkpoints 5, 10)
    const lessons = [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14];
    for (const l of lessons) {
      const unitId = l <= 4 ? 'unit-1' : l <= 9 ? 'unit-2' : 'unit-3';
      for (let i = 1; i <= 3; i++) {
        authoredPool.push(makeQuestion(`q-${l}-${i}`, l, unitId));
      }
    }
    // Add DRAFT and REJECTED questions that must never be served
    authoredPool.push(
      makeQuestion('q-draft', 14, 'unit-3', QuestionOrigin.AUTHORED, QuestionStatus.DRAFT),
      makeQuestion('q-rejected', 14, 'unit-3', QuestionOrigin.AUTHORED, QuestionStatus.REJECTED),
    );

    const webPool: CheckpointCandidateQuestion[] = [
      makeQuestion('w-1', 2, 'unit-1', QuestionOrigin.WEB, QuestionStatus.APPROVED),
      makeQuestion('w-2', 4, 'unit-1', QuestionOrigin.WEB, QuestionStatus.APPROVED),
      makeQuestion('w-3', 6, 'unit-2', QuestionOrigin.WEB, QuestionStatus.APPROVED),
      makeQuestion('w-4', 8, 'unit-2', QuestionOrigin.WEB, QuestionStatus.APPROVED),
      makeQuestion('w-5', 11, 'unit-3', QuestionOrigin.WEB, QuestionStatus.APPROVED),
      makeQuestion('w-6', 12, 'unit-3', QuestionOrigin.WEB, QuestionStatus.APPROVED),
      makeQuestion('w-draft', 13, 'unit-3', QuestionOrigin.WEB, QuestionStatus.DRAFT),
      makeQuestion('w-rejected', 14, 'unit-3', QuestionOrigin.WEB, QuestionStatus.REJECTED),
    ];

    const reviewQueueIds = new Set(['q-1-1', 'q-2-1', 'q-3-1']);

    const selected = selectCheckpointQuestions({
      authoredPool,
      webPool,
      reviewQueueQuestionIds: reviewQueueIds,
      rng: () => 0.42,
    });

    const selectedAuthored = selected.filter((q) => q.origin === QuestionOrigin.AUTHORED);
    const selectedWeb = selected.filter((q) => q.origin === QuestionOrigin.WEB);

    expect(selectedAuthored.length).toBe(20);
    expect(selectedWeb.length).toBe(5);
    expect(selected.length).toBe(25);

    // Never DRAFT or REJECTED
    expect(selected.every((q) => q.status === QuestionStatus.APPROVED)).toBe(true);

    // At least 1 from every unit reached
    const unitsCovered = new Set(selectedAuthored.map((q) => q.unitId));
    expect(unitsCovered).toEqual(new Set(['unit-1', 'unit-2', 'unit-3']));

    // 60% of 20 (= 12) from last 4 lessons (11, 12, 13, 14)
    const last4Count = selectedAuthored.filter((q) =>
      [11, 12, 13, 14].includes(q.levelNumber),
    ).length;
    expect(last4Count).toBe(12);

    // Older lessons bucket (8 questions) should include all 3 review-queue questions
    const selectedIds = new Set(selectedAuthored.map((q) => q.id));
    expect(selectedIds.has('q-1-1')).toBe(true);
    expect(selectedIds.has('q-2-1')).toBe(true);
    expect(selectedIds.has('q-3-1')).toBe(true);
  });
});
