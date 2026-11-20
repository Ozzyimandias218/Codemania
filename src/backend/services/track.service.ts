import { LevelType, PlacementStatus } from '@prisma/client';
import { prisma } from '../config/prisma.ts';
import { questionRepository } from '../repositories/question.repository.ts';
import { trackRepository } from '../repositories/track.repository.ts';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.ts';
import { shuffleArray } from '../utils/shuffle.ts';

export interface PrerequisiteCheckInput {
  prerequisites: Array<{
    requiredTrackId: string;
    requiredTrackTitle: string;
    requiredPoints: number;
  }>;
  userPointsByTrack: Map<string, number>;
}

export function evaluateTrackUnlock(input: PrerequisiteCheckInput): {
  unlocked: boolean;
  lockedReason: string | null;
} {
  for (const prereq of input.prerequisites) {
    const have = input.userPointsByTrack.get(prereq.requiredTrackId) ?? 0;
    if (have < prereq.requiredPoints) {
      return {
        unlocked: false,
        lockedReason: `Requires ${prereq.requiredPoints} points in ${prereq.requiredTrackTitle} (you have ${have}/${prereq.requiredPoints})`,
      };
    }
  }
  return { unlocked: true, lockedReason: null };
}

export function isLevelUnlocked(
  levelNumber: number,
  trackUnlocked: boolean,
  passedLevelNumbers: Set<number>,
): boolean {
  if (!trackUnlocked) return false;
  if (levelNumber <= 1) return true;
  return passedLevelNumbers.has(levelNumber - 1);
}

export function sanitizePublicQuestion(q: {
  id: string;
  levelId: string;
  type: string;
  prompt: string;
  codeSnippet: string | null;
  spokenText: string | null;
  options: unknown;
}) {
  return {
    id: q.id,
    levelId: q.levelId,
    type: q.type,
    prompt: q.prompt,
    codeSnippet: q.codeSnippet,
    spokenText: q.spokenText,
    options: q.options ?? null,
    // Security invariant: answer and explanation are NEVER sent before submission.
  };
}

export class TrackService {
  async listTracksForUser(userId: string) {
    const [tracks, groupedPoints] = await Promise.all([
      trackRepository.findAllTracksWithDetails(),
      trackRepository.findUserPointsGrouped(userId),
    ]);

    const pointsMap = new Map<string, number>();
    for (const row of groupedPoints) {
      pointsMap.set(row.trackId, row._sum.points ?? 0);
    }

    return tracks.map((track) => {
      const userPoints = pointsMap.get(track.id) ?? 0;
      const maxPoints = Math.floor(track.levelCount / 10);
      const { unlocked, lockedReason } = evaluateTrackUnlock({
        prerequisites: track.prerequisites.map((p) => ({
          requiredTrackId: p.requiredTrackId,
          requiredTrackTitle: p.requiredTrack.title,
          requiredPoints: p.requiredPoints,
        })),
        userPointsByTrack: pointsMap,
      });

      return {
        id: track.id,
        slug: track.slug,
        title: track.title,
        levelCount: track.levelCount,
        order: track.order,
        isPlaceholder: track.isPlaceholder,
        unlocked,
        lockedReason,
        userPoints,
        maxPoints,
        units: track.units,
      };
    });
  }

  async getTrackLevelsForUser(userId: string, slug: string) {
    const track = await trackRepository.findBySlug(slug);
    if (!track) {
      throw new NotFoundError(`Track "${slug}" not found`);
    }

    const [groupedPoints, progress] = await Promise.all([
      trackRepository.findUserPointsGrouped(userId),
      trackRepository.findUserLevelProgress(userId, track.id),
    ]);

    const pointsMap = new Map<string, number>();
    for (const row of groupedPoints) {
      pointsMap.set(row.trackId, row._sum.points ?? 0);
    }

    const { unlocked: trackUnlocked, lockedReason } = evaluateTrackUnlock({
      prerequisites: track.prerequisites.map((p) => ({
        requiredTrackId: p.requiredTrackId,
        requiredTrackTitle: p.requiredTrack.title,
        requiredPoints: p.requiredPoints,
      })),
      userPointsByTrack: pointsMap,
    });

    const passedByLevelId = new Map(progress.map((p) => [p.levelId, p]));
    const passedNumbers = new Set(progress.map((p) => p.level.number));

    const units = track.units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      order: unit.order,
      levels: unit.levels.map((level) => {
        const passed = passedByLevelId.get(level.id);
        return {
          id: level.id,
          number: level.number,
          type: level.type,
          title: level.title,
          isCheckpoint: level.type === LevelType.CHECKPOINT,
          awardsPoint: level.number % 10 === 0,
          unlocked: isLevelUnlocked(level.number, trackUnlocked, passedNumbers),
          passed: Boolean(passed),
          viaPlacement: passed?.viaPlacement ?? false,
          bestScorePct: passed?.bestScorePct ?? null,
        };
      }),
    }));

    return {
      track: {
        id: track.id,
        slug: track.slug,
        title: track.title,
        levelCount: track.levelCount,
        isPlaceholder: track.isPlaceholder,
        unlocked: trackUnlocked,
        lockedReason,
        userPoints: pointsMap.get(track.id) ?? 0,
        maxPoints: Math.floor(track.levelCount / 10),
      },
      units,
    };
  }

  async startPlacementTest(userId: string, slug: string, targetUnitOrder: number) {
    if (targetUnitOrder < 2) {
      throw new BadRequestError(
        'Placement test requires targetUnitOrder >= 2 so there are earlier levels to skip',
        'INVALID_TARGET_UNIT',
      );
    }

    const track = await trackRepository.findBySlug(slug);
    if (!track) {
      throw new NotFoundError(`Track "${slug}" not found`);
    }

    const targetUnit = track.units.find((u) => u.order === targetUnitOrder);
    if (!targetUnit) {
      throw new NotFoundError(`Unit order ${targetUnitOrder} not found in track "${slug}"`);
    }

    const groupedPoints = await trackRepository.findUserPointsGrouped(userId);
    const pointsMap = new Map(groupedPoints.map((r) => [r.trackId, r._sum.points ?? 0]));
    const { unlocked, lockedReason } = evaluateTrackUnlock({
      prerequisites: track.prerequisites.map((p) => ({
        requiredTrackId: p.requiredTrackId,
        requiredTrackTitle: p.requiredTrack.title,
        requiredPoints: p.requiredPoints,
      })),
      userPointsByTrack: pointsMap,
    });
    if (!unlocked) {
      throw new ForbiddenError(lockedReason ?? 'Track is locked', 'TRACK_LOCKED');
    }

    const pool = await questionRepository.findApprovedInTrackUnitsUpTo(track.id, targetUnitOrder);
    if (pool.length === 0) {
      throw new BadRequestError('No approved questions available for placement test');
    }

    // Sample up to 3 questions per earlier unit, shuffled
    const byUnit = new Map<number, typeof pool>();
    for (const q of pool) {
      const uOrder = q.level.unit.order;
      const arr = byUnit.get(uOrder) ?? [];
      arr.push(q);
      byUnit.set(uOrder, arr);
    }

    const selected: typeof pool = [];
    for (const [, unitQuestions] of Array.from(byUnit.entries()).sort((a, b) => a[0] - b[0])) {
      selected.push(...shuffleArray(unitQuestions).slice(0, 3));
    }

    const finalSelection = shuffleArray(selected);
    const test = await trackRepository.createPlacementTest({
      userId,
      trackId: track.id,
      targetUnitId: targetUnit.id,
      targetUnitOrder,
      questionIds: finalSelection.map((q) => q.id),
    });

    return {
      placementTestId: test.id,
      trackSlug: track.slug,
      targetUnitOrder,
      questions: finalSelection.map(sanitizePublicQuestion),
    };
  }

  async submitPlacementTest(
    userId: string,
    slug: string,
    testId: string,
    answers: Array<{ questionId: string; answer: string }>,
  ) {
    const test = await trackRepository.findPlacementTestById(testId);
    if (!test || test.userId !== userId) {
      throw new NotFoundError('Placement test not found');
    }
    if (test.status !== PlacementStatus.IN_PROGRESS) {
      throw new ConflictError('Placement test has already been submitted');
    }

    const track = await trackRepository.findBySlug(slug);
    if (!track || track.id !== test.trackId) {
      throw new NotFoundError('Track mismatch for placement test');
    }

    const expectedQuestionIds = test.questionIds as string[];
    const questions = await questionRepository.findManyByIds(expectedQuestionIds);
    const questionMap = new Map(questions.map((q) => [q.id, q]));
    const answerMap = new Map(answers.map((a) => [a.questionId, a.answer.trim()]));

    let correctCount = 0;
    for (const qId of expectedQuestionIds) {
      const q = questionMap.get(qId);
      const submitted = answerMap.get(qId);
      if (q && submitted !== undefined && submitted === q.answer.trim()) {
        correctCount++;
      }
    }

    const scorePct = expectedQuestionIds.length > 0 ? correctCount / expectedQuestionIds.length : 0;
    const passed = scorePct >= 0.7;

    const earlierLevels = track.units
      .filter((u) => u.order < test.targetUnitOrder)
      .flatMap((u) => u.levels);

    await prisma.$transaction(async (tx) => {
      await trackRepository.updatePlacementTest(
        test.id,
        {
          status: passed ? PlacementStatus.PASSED : PlacementStatus.FAILED,
          scorePct,
          completedAt: new Date(),
        },
        tx,
      );

      if (passed) {
        // Mark earlier levels as passed with NO points and NO XP.
        for (const lvl of earlierLevels) {
          await trackRepository.upsertLevelPassed(
            {
              userId,
              levelId: lvl.id,
              trackId: track.id,
              viaPlacement: true,
              scorePct,
            },
            tx,
          );
        }
      }
    });

    return {
      placementTestId: test.id,
      passed,
      scorePct,
      correctCount,
      totalQuestions: expectedQuestionIds.length,
      skippedLevelsCount: passed ? earlierLevels.length : 0,
      xpAwarded: 0,
      pointsAwarded: 0,
    };
  }
}

export const trackService = new TrackService();
