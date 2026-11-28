import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/backend/app.ts';
import { getPythonCodingChallenge } from '../src/backend/services/codingLessons.ts';
import { runPythonTestCases } from '../src/backend/services/pythonRunner.service.ts';
import { TutorService, tutorService } from '../src/backend/services/tutor.service.ts';
import { AppError } from '../src/backend/utils/errors.ts';

describe('Python Sandbox Runner', () => {
  it('passes all test cases for valid Python code', async () => {
    const challenge = getPythonCodingChallenge(1);
    const result = await runPythonTestCases('score = 42\nlanguage = "Python"\n', challenge.testCases);

    expect(result.allPassed).toBe(true);
    expect(result.passedCount).toBe(2);
    expect(result.totalCount).toBe(2);
    expect(result.timedOut).toBe(false);
    expect(result.syntaxError).toBeNull();
  });

  it('captures expected vs actual on failing logic', async () => {
    const challenge = getPythonCodingChallenge(2);
    const result = await runPythonTestCases(
      'def calculate_total(price, qty):\n    return price + qty\n\ndef remainder_of(a, b):\n    return a % b\n',
      challenge.testCases,
    );

    expect(result.allPassed).toBe(false);
    expect(result.passedCount).toBe(1);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].expected).toBe('36');
    expect(result.results[0].actual).toBe('15');
    expect(result.results[2].passed).toBe(true);
  });

  it('reports SyntaxError cleanly', async () => {
    const challenge = getPythonCodingChallenge(1);
    const result = await runPythonTestCases('score = \n', challenge.testCases);

    expect(result.allPassed).toBe(false);
    expect(result.syntaxError).toContain('SyntaxError');
  });

  it('blocks restricted modules like os', async () => {
    const challenge = getPythonCodingChallenge(1);
    const result = await runPythonTestCases('import os\nscore = 42\n', challenge.testCases);

    expect(result.allPassed).toBe(false);
    expect(result.runtimeError).toContain("Import of 'os' is restricted");
  });

  it('terminates infinite loops after timeout', async () => {
    const challenge = getPythonCodingChallenge(1);
    const result = await runPythonTestCases('while True:\n    pass\n', challenge.testCases, 700);

    expect(result.allPassed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.runtimeError).toContain('timed out');
  });
});

describe('TutorService structured Gemini evaluation', () => {
  it('retries once on invalid JSON and returns validated structured output', async () => {
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({ text: 'not valid json {' })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          feedback: 'Great job binding both variables to the right types.',
          score: 96,
          nextAction: 'advance',
        }),
      });

    const svc = new TutorService(() => ({
      models: { generateContent },
    }));

    const challenge = getPythonCodingChallenge(1);
    const runResult = await runPythonTestCases('score = 42\nlanguage = "Python"\n', challenge.testCases);
    const evalRes = await svc.evaluateSubmission({
      lessonGoal: challenge.lessonGoal,
      levelTitle: challenge.title,
      code: 'score = 42\nlanguage = "Python"',
      runResult,
    });

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(evalRes).toEqual({
      feedback: 'Great job binding both variables to the right types.',
      score: 96,
      nextAction: 'advance',
    });
  });

  it('prevents advancing when tests fail even if model suggests advance', async () => {
    const generateContent = vi.fn().mockResolvedValueOnce({
      text: JSON.stringify({
        feedback: 'Double-check your arithmetic operator in calculate_total.',
        score: 95,
        nextAction: 'advance',
      }),
    });

    const svc = new TutorService(() => ({
      models: { generateContent },
    }));

    const challenge = getPythonCodingChallenge(2);
    const runResult = await runPythonTestCases(
      'def calculate_total(price, qty):\n    return price + qty\n\ndef remainder_of(a, b):\n    return a % b\n',
      challenge.testCases,
    );

    const evalRes = await svc.evaluateSubmission({
      lessonGoal: challenge.lessonGoal,
      levelTitle: challenge.title,
      code: '...',
      runResult,
    });

    expect(evalRes.nextAction).toBe('retry');
    expect(evalRes.score).toBeLessThanOrEqual(30);
  });

  it('throws GEMINI_KEY_MISSING without exposing secrets when key is unset', async () => {
    const orig = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const challenge = getPythonCodingChallenge(1);
      const runResult = await runPythonTestCases('score = 42\nlanguage = "Python"\n', challenge.testCases);
      await expect(
        tutorService.evaluateSubmission({
          lessonGoal: challenge.lessonGoal,
          levelTitle: challenge.title,
          code: 'score = 42',
          runResult,
        }),
      ).rejects.toMatchObject({
        code: 'GEMINI_KEY_MISSING',
        statusCode: 503,
      } satisfies Partial<AppError>);
    } finally {
      if (orig !== undefined) process.env.GEMINI_API_KEY = orig;
    }
  });
});

describe('AI Tutor API routes & progress updates', () => {
  let server: http.Server;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    const app = createApp({ useSandboxFallback: true });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral server');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const regRes = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'tutor-tester@codemania.dev',
        password: 'Password123!',
        name: 'Tutor Tester',
        isAdult: true,
      }),
    });
    const regJson = (await regRes.json()) as { accessToken: string };
    token = regJson.accessToken;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('returns coding challenge for unlocked Python level 1', async () => {
    const res = await fetch(`${baseUrl}/api/tutor/challenge/track-py-l1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      levelId: string;
      levelNumber: number;
      lessonGoal: string;
      testCases: unknown[];
    };
    expect(body.levelId).toBe('track-py-l1');
    expect(body.levelNumber).toBe(1);
    expect(body.lessonGoal).toContain('score');
    expect(body.testCases.length).toBeGreaterThan(0);
  });

  it('rejects empty or oversized code submissions', async () => {
    const emptyRes = await fetch(`${baseUrl}/api/tutor`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ levelId: 'track-py-l1', code: '   ' }),
    });
    expect(emptyRes.status).toBe(400);

    const longRes = await fetch(`${baseUrl}/api/tutor`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ levelId: 'track-py-l1', code: 'x = 1\n'.repeat(600) }),
    });
    expect(longRes.status).toBe(400);
  });

  it('evaluates submission, updates XP/streak, and unlocks next level on advance', async () => {
    const spy = vi.spyOn(tutorService, 'evaluateSubmission').mockResolvedValueOnce({
      feedback: 'Clean solution: both score and language match expected values.',
      score: 100,
      nextAction: 'advance',
    });

    const res = await fetch(`${baseUrl}/api/tutor`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        levelId: 'track-py-l1',
        code: 'score = 42\nlanguage = "Python"\n',
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      testResults: { allPassed: boolean };
      tutor: { nextAction: string; score: number };
      progressUpdate: {
        levelPassed: boolean;
        newlyCompleted: boolean;
        xpAwarded: number;
        nextLevelId: string | null;
        nextLevelNumber: number | null;
      };
    };

    expect(spy).toHaveBeenCalledTimes(1);
    expect(data.testResults.allPassed).toBe(true);
    expect(data.tutor.nextAction).toBe('advance');
    expect(data.tutor.score).toBe(100);
    expect(data.progressUpdate.levelPassed).toBe(true);
    expect(data.progressUpdate.newlyCompleted).toBe(true);
    expect(data.progressUpdate.xpAwarded).toBe(20);
    expect(data.progressUpdate.nextLevelNumber).toBe(2);

    // Confirm level 2 is now unlocked via /tracks/python/levels
    const levelsRes = await fetch(`${baseUrl}/tracks/python/levels`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const levelsBody = (await levelsRes.json()) as {
      units: Array<{ levels: Array<{ number: number; unlocked: boolean; passed: boolean }> }>;
    };
    const l1 = levelsBody.units[0].levels.find((l) => l.number === 1);
    const l2 = levelsBody.units[0].levels.find((l) => l.number === 2);
    expect(l1?.passed).toBe(true);
    expect(l2?.unlocked).toBe(true);
  });

  it('enqueues concept review when tutor recommends review', async () => {
    vi.spyOn(tutorService, 'evaluateSubmission').mockResolvedValueOnce({
      feedback: 'Remember that variables use = and strings require quotes.',
      score: 20,
      nextAction: 'review',
    });

    const res = await fetch(`${baseUrl}/api/tutor`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        levelId: 'track-py-l2',
        code: 'def calculate_total(price, qty):\n    return 0\n',
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      testResults: { allPassed: boolean };
      tutor: { nextAction: string };
      progressUpdate: { reviewEnqueued: boolean; levelPassed: boolean };
    };
    expect(data.testResults.allPassed).toBe(false);
    expect(data.tutor.nextAction).toBe('review');
    expect(data.progressUpdate.levelPassed).toBe(false);
    expect(data.progressUpdate.reviewEnqueued).toBe(true);
  });
});
