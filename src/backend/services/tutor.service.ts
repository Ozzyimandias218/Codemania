import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { z } from 'zod';
import { AppError } from '../utils/errors.ts';
import type { PythonRunResult } from './pythonRunner.service.ts';

export type TutorNextAction = 'retry' | 'advance' | 'review';

export interface TutorEvaluation {
  feedback: string;
  score: number;
  nextAction: TutorNextAction;
}

export interface EvaluateTutorParams {
  lessonGoal: string;
  levelTitle: string;
  code: string;
  runResult: PythonRunResult;
}

export const tutorOutputSchema = z.object({
  feedback: z.string().trim().min(1).max(1500),
  score: z.number().int().min(0).max(100),
  nextAction: z.enum(['retry', 'advance', 'review']),
});

export interface GeminiClientLike {
  models: {
    generateContent: (args: Record<string, unknown>) => Promise<{ text?: string | undefined }>;
  };
}

function defaultClientFactory(): GeminiClientLike {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new AppError(
      503,
      'GEMINI_KEY_MISSING',
      'AI Tutor requires GEMINI_API_KEY to be configured on the server.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  }) as unknown as GeminiClientLike;
}

function mapGeminiError(err: unknown): never {
  if (err instanceof AppError) throw err;
  const rawMsg = err instanceof Error ? err.message : 'AI Tutor request failed';
  // Never echo potential API key strings or credentials
  const safeMsg = rawMsg.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]');

  if (
    safeMsg.includes('PERMISSION_DENIED') ||
    safeMsg.includes('API_KEY_INVALID') ||
    safeMsg.includes('403')
  ) {
    throw new AppError(
      502,
      'GEMINI_API_KEY_ERROR',
      'Server GEMINI_API_KEY was rejected by Gemini. Check Settings > Secrets.',
    );
  }
  if (safeMsg.includes('RESOURCE_EXHAUSTED') || safeMsg.includes('429')) {
    throw new AppError(
      429,
      'GEMINI_RATE_LIMITED',
      'AI Tutor rate limit reached. Please wait a moment and try again.',
    );
  }
  if (safeMsg.toLowerCase().includes('timeout') || safeMsg.includes('ABORT')) {
    throw new AppError(
      504,
      'GEMINI_TIMEOUT',
      'AI Tutor took too long to respond. Please try submitting again.',
    );
  }
  throw new AppError(502, 'GEMINI_UPSTREAM_ERROR', `AI Tutor unavailable: ${safeMsg}`);
}

export class TutorService {
  constructor(private readonly clientFactory: () => GeminiClientLike = defaultClientFactory) {}

  async evaluateSubmission(params: EvaluateTutorParams): Promise<TutorEvaluation> {
    const ai = this.clientFactory();
    const { lessonGoal, levelTitle, code, runResult } = params;

    const systemInstruction = [
      'You are a supportive, concise Python coding tutor on a Duolingo-style learning platform.',
      'Evaluate the learner code strictly against the lesson goal and the real automated test results provided.',
      'CRITICAL PEDAGOGY RULE: Never write out or reveal the complete working solution code! Give a clear, actionable hint pointing out what is missing, why a test failed, or how to improve.',
      'Keep feedback to 2-4 crisp plain-text sentences (no markdown code fences with full solutions).',
      'Scoring and nextAction rules:',
      '- Set nextAction to "advance" ONLY when all tests passed (allPassed is true), with score between 80 and 100.',
      '- Set nextAction to "retry" when the learner is close (some tests passed, or small logic/syntax slip), with score 35..79.',
      '- Set nextAction to "review" when core syntax/concepts are missing, zero tests passed, or execution timed out, with score 0..45.',
    ].join('\n');

    const promptPayload = JSON.stringify(
      {
        levelTitle,
        lessonGoal,
        learnerCode: code,
        testExecution: {
          allPassed: runResult.allPassed,
          passedCount: runResult.passedCount,
          totalCount: runResult.totalCount,
          timedOut: runResult.timedOut,
          syntaxError: runResult.syntaxError,
          runtimeError: runResult.runtimeError,
          results: runResult.results.map((r) => ({
            description: r.description,
            passed: r.passed,
            expected: r.expected,
            actual: r.actual,
            error: r.error,
          })),
        },
      },
      null,
      2,
    );

    const requestConfig = {
      model: 'gemini-4-hydrogen',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Evaluate this Python submission and return the structured JSON response:\n\n${promptPayload}`,
            },
          ],
        },
      ],
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            feedback: {
              type: Type.STRING,
              description:
                'Helpful hint guiding the learner toward the fix without revealing the full solution.',
            },
            score: {
              type: Type.INTEGER,
              description: 'Integer score from 0 to 100 grounded in test pass rate and code quality.',
            },
            nextAction: {
              type: Type.STRING,
              enum: ['retry', 'advance', 'review'],
              description: 'Recommended next step: retry, advance, or review.',
            },
          },
          required: ['feedback', 'score', 'nextAction'],
        },
      },
    };

    let parsed: TutorEvaluation | null = null;
    let lastError: unknown = null;

    // Try up to 2 attempts (initial + 1 retry if Gemini returns malformed JSON)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent(requestConfig);
        const rawText = (response.text ?? '').trim();
        if (!rawText) {
          throw new Error('Empty response from Gemini');
        }
        const json = JSON.parse(rawText) as unknown;
        parsed = tutorOutputSchema.parse(json);
        break;
      } catch (err) {
        lastError = err;
        // Do not retry auth/quota/key errors
        const msg = err instanceof Error ? err.message : '';
        if (
          err instanceof AppError ||
          msg.includes('PERMISSION_DENIED') ||
          msg.includes('API_KEY_INVALID') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('429') ||
          msg.includes('403')
        ) {
          mapGeminiError(err);
        }
      }
    }

    if (!parsed) {
      if (lastError instanceof z.ZodError || lastError instanceof SyntaxError) {
        throw new AppError(
          502,
          'GEMINI_INVALID_JSON',
          'AI Tutor returned an unexpected response format. Please try submitting again.',
        );
      }
      mapGeminiError(lastError);
    }

    // Ground nextAction and score strictly against real sandbox test execution
    return this.groundEvaluation(parsed, runResult);
  }

  private groundEvaluation(raw: TutorEvaluation, runResult: PythonRunResult): TutorEvaluation {
    if (runResult.timedOut || runResult.syntaxError || !runResult.allPassed) {
      const ratio =
        runResult.totalCount > 0 ? runResult.passedCount / runResult.totalCount : 0;
      const maxAllowedScore = Math.max(10, Math.round(ratio * 85));
      const boundedScore = Math.min(raw.score, maxAllowedScore);
      const safeAction: TutorNextAction =
        raw.nextAction === 'advance'
          ? runResult.passedCount > 0
            ? 'retry'
            : 'review'
          : raw.nextAction;
      return {
        feedback: raw.feedback,
        score: boundedScore,
        nextAction: safeAction,
      };
    }

    // All tests passed
    const boundedScore = Math.max(70, Math.min(100, raw.score));
    return {
      feedback: raw.feedback,
      score: boundedScore,
      nextAction: 'advance',
    };
  }
}

export const tutorService = new TutorService();
