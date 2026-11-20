import { QuestionStatus, VoiceAssetStatus, VoiceContentType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptRepository } from '../src/backend/repositories/attempt.repository.ts';
import { questionRepository } from '../src/backend/repositories/question.repository.ts';
import { voiceRepository } from '../src/backend/repositories/voice.repository.ts';
import { TtsProvider } from '../src/backend/services/tts/tts.provider.ts';
import {
  VoiceService,
  buildQuestionPromptTranscript,
} from '../src/backend/services/tts/voice.service.ts';
import { ForbiddenError } from '../src/backend/utils/errors.ts';

describe('Audio gating & transcript safety', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('never includes codeSnippet verbatim or answer in QUESTION_PROMPT transcript', () => {
    const transcript = buildQuestionPromptTranscript({
      prompt: 'What is the output of this loop?',
      spokenText: 'What does the loop print?',
    });
    expect(transcript).toBe('What does the loop print?');
    expect(transcript).not.toContain('42');

    const fallback = buildQuestionPromptTranscript({
      prompt: 'Which keyword defines a function?',
      spokenText: null,
    });
    expect(fallback).toBe('Which keyword defines a function?');
  });

  it('returns 403 for explanation audio until user submits an answer, then returns audio after submission', async () => {
    const mockTts: TtsProvider = {
      synthesize: vi.fn().mockResolvedValue({ audioUrl: 'https://cdn.test/exp.wav' }),
    };
    const voiceService = new VoiceService(mockTts);

    vi.spyOn(questionRepository, 'findById').mockResolvedValue({
      id: 'q1',
      levelId: 'l1',
      questionGroupId: 'g1',
      type: 'MULTIPLE_CHOICE',
      prompt: 'Prompt text',
      codeSnippet: 'print(1)',
      spokenText: null,
      options: ['a', 'b', 'c', 'd'],
      answer: '0',
      explanation: 'Because option 0 is correct.',
      origin: 'AUTHORED',
      sourceUrl: null,
      license: null,
      status: QuestionStatus.APPROVED,
      rejectionReason: null,
      version: 1,
      isLatest: true,
      createdById: null,
      reviewedById: null,
      reviewedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      level: {} as never,
    });

    // Before submitting an answer -> 403 Forbidden
    vi.spyOn(attemptRepository, 'hasUserAnsweredQuestion').mockResolvedValueOnce(false);
    await expect(voiceService.getQuestionExplanationAudio('u1', 'q1')).rejects.toThrow(
      ForbiddenError,
    );

    // After submitting an answer -> 200 OK with READY asset
    vi.spyOn(attemptRepository, 'hasUserAnsweredQuestion').mockResolvedValueOnce(true);
    vi.spyOn(voiceRepository, 'findByUniqueKey').mockResolvedValueOnce({
      id: 'va1',
      contentType: VoiceContentType.EXPLANATION,
      contentId: 'q1',
      language: 'en',
      voiceId: 'default',
      textHash: 'hash',
      audioUrl: 'https://cdn.test/exp.wav',
      transcript: 'Because option 0 is correct.',
      status: VoiceAssetStatus.READY,
      attempts: 1,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const audio = await voiceService.getQuestionExplanationAudio('u1', 'q1');
    expect(audio.audioUrl).toBe('https://cdn.test/exp.wav');
    expect(audio.status).toBe(VoiceAssetStatus.READY);
  });

  it('reuses existing READY VoiceAsset by textHash without calling external TTS again', async () => {
    const mockTts: TtsProvider = {
      synthesize: vi.fn().mockResolvedValue({ audioUrl: 'https://cdn.test/new.wav' }),
    };
    const voiceService = new VoiceService(mockTts);

    vi.spyOn(voiceRepository, 'findReadyByHash').mockResolvedValue({
      id: 'va-existing',
      contentType: VoiceContentType.QUESTION_PROMPT,
      contentId: 'q-old',
      language: 'en',
      voiceId: 'default',
      textHash: 'same-hash',
      audioUrl: 'https://cdn.test/reused.wav',
      transcript: 'Same text',
      status: VoiceAssetStatus.READY,
      attempts: 1,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const upsertSpy = vi.spyOn(voiceRepository, 'upsertPendingOrReuse').mockResolvedValue({
      id: 'va-new',
      contentType: VoiceContentType.QUESTION_PROMPT,
      contentId: 'q-new',
      language: 'en',
      voiceId: 'default',
      textHash: 'same-hash',
      audioUrl: 'https://cdn.test/reused.wav',
      transcript: 'Same text',
      status: VoiceAssetStatus.READY,
      attempts: 0,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await voiceService.queueVoiceForApprovedQuestion({
      id: 'q-new',
      status: QuestionStatus.APPROVED,
      prompt: 'Same text',
      spokenText: null,
      explanation: 'Same text',
    });

    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reusedAudioUrl: 'https://cdn.test/reused.wav',
      }),
    );
    expect(mockTts.synthesize).not.toHaveBeenCalled();
  });
});
