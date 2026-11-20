import { MissedDayMode, PenaltyType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  applyPenaltyCap,
  calculateRequiredLevelsPerDay,
  computeNewPenaltiesForCommitment,
  evaluatePaceRequirement,
} from '../src/backend/services/commitment.service.ts';
import { UnprocessableError } from '../src/backend/utils/errors.ts';

describe('Pace calculation', () => {
  it('computes requiredLevelsPerDay = remaining / durationDays and rejects above MAX_LEVELS_PER_DAY unless acknowledgePace=true', () => {
    expect(calculateRequiredLevelsPerDay(50, 10)).toBe(5);

    expect(() =>
      evaluatePaceRequirement({
        remainingLevels: 50,
        durationDays: 10,
        maxLevelsPerDay: 3,
        acknowledgePace: false,
      }),
    ).toThrow(UnprocessableError);

    const acknowledged = evaluatePaceRequirement({
      remainingLevels: 50,
      durationDays: 10,
      maxLevelsPerDay: 3,
      acknowledgePace: true,
    });
    expect(acknowledged.requiredLevelsPerDay).toBe(5);
    expect(acknowledged.exceedsRecommendedPace).toBe(true);
  });
});

describe('Missed-day calculation & penalty cap', () => {
  it('INACTIVE_DAYS uses excusedDaysAllowed first and charges remaining missed days idempotently', () => {
    const startDate = new Date('2026-11-01T00:00:00Z');
    // Evaluate on Nov 6 -> completed days Nov 1..Nov 5 (5 days).
    // Passed only on Nov 1 and Nov 3 -> 3 missed days (Nov 2, Nov 4, Nov 5).
    // excusedDaysAllowed = 2 -> only 1 unexcused missed day (Nov 5).
    const res = computeNewPenaltiesForCommitment({
      startDate,
      durationDays: 10,
      timezone: 'UTC',
      missedDayMode: MissedDayMode.INACTIVE_DAYS,
      excusedDaysAllowed: 2,
      dailyPenaltyCents: 100,
      finalFailPenaltyCents: 1000,
      maxTotalPenaltyCents: 2000,
      passedLevelDatesInTz: new Set(['2026-11-01', '2026-11-03']),
      finalPassedAt: null,
      now: new Date('2026-11-06T12:00:00Z'),
      existingPenalties: [],
    });

    expect(res.contractWindowEndedWithGrace).toBe(false);
    expect(res.newPenalties).toEqual([
      { type: PenaltyType.DAILY_MISSED, date: '2026-11-05', amountCents: 100 },
    ]);

    // Idempotency: running again with existing penalty yields 0 new penalties
    const rerun = computeNewPenaltiesForCommitment({
      startDate,
      durationDays: 10,
      timezone: 'UTC',
      missedDayMode: MissedDayMode.INACTIVE_DAYS,
      excusedDaysAllowed: 2,
      dailyPenaltyCents: 100,
      finalFailPenaltyCents: 1000,
      maxTotalPenaltyCents: 2000,
      passedLevelDatesInTz: new Set(['2026-11-01', '2026-11-03']),
      finalPassedAt: null,
      now: new Date('2026-11-06T18:00:00Z'),
      existingPenalties: [
        { type: PenaltyType.DAILY_MISSED, date: '2026-11-05', amountCents: 100, voidedAt: null },
      ],
    });
    expect(rerun.newPenalties).toEqual([]);
  });

  it('LATE_DAYS counts days after deadline + 24h grace and applies FINAL_FAIL once, capped at maxTotalPenaltyCents', () => {
    // startDate Nov 1, duration 5 days -> deadline Nov 6 00:00Z -> grace ends Nov 7 00:00Z.
    // Evaluate on Nov 10 12:00Z (completed late days: Nov 8, Nov 9) + 1 FINAL_FAIL.
    const res = computeNewPenaltiesForCommitment({
      startDate: new Date('2026-11-01T00:00:00Z'),
      durationDays: 5,
      timezone: 'UTC',
      missedDayMode: MissedDayMode.LATE_DAYS,
      excusedDaysAllowed: 2,
      dailyPenaltyCents: 200,
      finalFailPenaltyCents: 1000,
      maxTotalPenaltyCents: 1150, // Cap below 200 + 200 + 1000 = 1400!
      passedLevelDatesInTz: new Set(),
      finalPassedAt: null,
      now: new Date('2026-11-10T12:00:00Z'),
      existingPenalties: [],
    });

    expect(res.contractWindowEndedWithGrace).toBe(true);
    const total = res.newPenalties.reduce((s, p) => s + p.amountCents, 0);
    expect(total).toBe(1150);
    expect(res.newPenalties).toEqual([
      { type: PenaltyType.LATE_DAY, date: '2026-11-08', amountCents: 200 },
      { type: PenaltyType.LATE_DAY, date: '2026-11-09', amountCents: 200 },
      { type: PenaltyType.FINAL_FAIL, date: 'FINAL', amountCents: 750 },
    ]);
  });

  it('applyPenaltyCap never exceeds maxTotalPenaltyCents', () => {
    expect(
      applyPenaltyCap({
        existingActivePenaltiesCents: 900,
        proposedPenaltyCents: 500,
        maxTotalPenaltyCents: 1000,
      }),
    ).toBe(100);
    expect(
      applyPenaltyCap({
        existingActivePenaltiesCents: 1000,
        proposedPenaltyCents: 500,
        maxTotalPenaltyCents: 1000,
      }),
    ).toBe(0);
  });
});
