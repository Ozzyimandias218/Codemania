import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { Response, Router } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';
import { validateBody } from '../middleware/validate.middleware.ts';
import { AppError, BadRequestError } from '../utils/errors.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new AppError(
      503,
      'GEMINI_KEY_MISSING',
      'Aristotle voice & AI coaching require GEMINI_API_KEY to be configured in Settings > Secrets.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function mapGeminiError(err: unknown): never {
  if (err instanceof AppError) throw err;
  const msg = err instanceof Error ? err.message : 'Gemini request failed';
  if (msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID') || msg.includes('403') || msg.includes('400')) {
    throw new AppError(
      502,
      'GEMINI_API_KEY_ERROR',
      'Please verify your GEMINI_API_KEY in Settings > Secrets and try again.',
    );
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    throw new AppError(
      429,
      'GEMINI_RATE_LIMITED',
      'Gemini quota temporarily exhausted. Please try again in a moment or check Settings > Secrets.',
    );
  }
  throw new AppError(502, 'GEMINI_UPSTREAM_ERROR', msg);
}

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  mode: z.enum(['hint', 'explain', 'debug', 'plan', 'general']).default('general'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'model']),
        text: z.string().min(1).max(2000),
      }),
    )
    .max(12)
    .optional(),
  context: z
    .object({
      activeTab: z.string().optional(),
      trackTitle: z.string().optional(),
      unitTitle: z.string().optional(),
      levelNumber: z.number().int().optional(),
      levelType: z.string().optional(),
      questionPrompt: z.string().optional(),
      codeSnippet: z.string().nullable().optional(),
      stats: z
        .object({
          xp: z.number().optional(),
          currentStreak: z.number().optional(),
          totalPoints: z.number().optional(),
          passedLevelsCount: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

const speakSchema = z.object({
  text: z.string().min(1).max(1600),
  style: z.string().max(160).optional(),
});

const transcribeSchema = z.object({
  audioBase64: z.string().min(16),
  mimeType: z.string().min(5).max(80),
});

export const aristotleRouter = Router();

aristotleRouter.post(
  '/chat',
  requireAuth,
  validateBody(chatSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ai = getGeminiClient();
    const { message, mode, history = [], context } = req.body as z.infer<typeof chatSchema>;

    const contextLines: string[] = [];
    if (context?.activeTab) contextLines.push(`Active section: ${context.activeTab}`);
    if (context?.trackTitle) contextLines.push(`Course: ${context.trackTitle}`);
    if (context?.unitTitle) contextLines.push(`Unit: ${context.unitTitle}`);
    if (context?.levelNumber) contextLines.push(`Level ${context.levelNumber} (${context.levelType ?? 'LESSON'})`);
    if (context?.questionPrompt) contextLines.push(`Current question prompt: ${context.questionPrompt}`);
    if (context?.codeSnippet) contextLines.push(`Code snippet shown:\n${context.codeSnippet}`);
    if (context?.stats) {
      contextLines.push(
        `Learner stats: ${context.stats.xp ?? 0} XP, ${context.stats.currentStreak ?? 0}-day streak, ${context.stats.totalPoints ?? 0} points, ${context.stats.passedLevelsCount ?? 0} passed levels.`,
      );
    }

    const systemInstruction = [
      'You are Aristotle, a wise, warm, practical 21st-century computer science teacher inside Codemania.',
      'Your answers are concise (2-5 clear sentences, plain readable prose without markdown clutter) so they work effortlessly both on screen and read aloud by voice.',
      'CRITICAL RULE: If the learner currently has an active lesson, checkpoint, or daily quiz question open, NEVER reveal the exact final answer or option index directly. Always give a guiding Socratic hint, explain the underlying rule, or trace the logic step-by-step so they solve it themselves.',
      `Current mode: ${mode}.`,
      contextLines.length > 0 ? `Live learner context:\n${contextLines.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const contents = [
      ...history.map((h) => ({
        role: h.role,
        parts: [{ text: h.text }],
      })),
      {
        role: 'user',
        parts: [{ text: message }],
      },
    ];

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const reply = response.text?.trim();
      if (!reply) {
        throw new BadRequestError('Aristotle could not formulate a response.');
      }

      res.status(200).json({ reply });
    } catch (err) {
      mapGeminiError(err);
    }
  }),
);

aristotleRouter.post(
  '/speak',
  requireAuth,
  validateBody(speakSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ai = getGeminiClient();
    const { text, style } = req.body as z.infer<typeof speakSchema>;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text,
                speechMetadata: {
                  style: style ?? 'Warm, articulate, unhurried computer science mentor',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Charon' },
            },
          },
        },
      });

      const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioBase64) {
        throw new BadRequestError('Speech synthesis returned no audio.');
      }

      res.status(200).json({
        mimeType: 'audio/wav',
        audioBase64,
      });
    } catch (err) {
      mapGeminiError(err);
    }
  }),
);

aristotleRouter.post(
  '/transcribe',
  requireAuth,
  validateBody(transcribeSchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ai = getGeminiClient();
    const { audioBase64, mimeType } = req.body as z.infer<typeof transcribeSchema>;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            {
              text: 'Transcribe this student voice question about programming accurately in plain text.',
            },
          ],
        },
      });

      const transcript = (response.text ?? '').trim();
      res.status(200).json({ transcript });
    } catch (err) {
      mapGeminiError(err);
    }
  }),
);
