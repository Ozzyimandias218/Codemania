import { QuestionStatus, VoiceAssetStatus, VoiceContentType } from '@prisma/client';
import { env } from '../../config/env.ts';
import { jobDispatcher } from '../../jobs/queues.ts';
import { attemptRepository } from '../../repositories/attempt.repository.ts';
import { questionRepository } from '../../repositories/question.repository.ts';
import { voiceRepository } from '../../repositories/voice.repository.ts';
import { ForbiddenError, NotFoundError } from '../../utils/errors.ts';
import { computeTtsTextHash } from '../../utils/hash.ts';
import { HuggingFaceTtsProvider } from './huggingface.adapter.ts';
import { TtsProvider } from './tts.provider.ts';

/**
 * Builds the exact transcript for TTS without reading codeSnippet verbatim
 * and never embedding the answer inside QUESTION_PROMPT audio.
 */
export function buildQuestionPromptTranscript(question: {
  prompt: string;
  spokenText?: string | null;
}): string {
  const raw = (question.spokenText && question.spokenText.trim().length > 0
    ? question.spokenText
    : question.prompt
  ).trim();
  return raw;
}

export function buildExplanationTranscript(question: {
  explanation: string;
}): string {
  return question.explanation.trim();
}

export class VoiceService {
  constructor(private readonly ttsProvider: TtsProvider = new HuggingFaceTtsProvider()) {}

  async queueVoiceForApprovedQuestion(
    question: {
      id: string;
      status: QuestionStatus;
      prompt: string;
      spokenText?: string | null;
      explanation: string;
    },
    language: string = env.TTS_DEFAULT_LANGUAGE,
    voiceId: string = env.TTS_DEFAULT_VOICE_ID,
  ) {
    if (question.status !== QuestionStatus.APPROVED) {
      return [];
    }

    const targets: Array<{ contentType: VoiceContentType; transcript: string }> = [
      {
        contentType: VoiceContentType.QUESTION_PROMPT,
        transcript: buildQuestionPromptTranscript(question),
      },
      {
        contentType: VoiceContentType.EXPLANATION,
        transcript: buildExplanationTranscript(question),
      },
    ];

    const assets = [];
    for (const target of targets) {
      const textHash = computeTtsTextHash({
        contentType: target.contentType,
        transcript: target.transcript,
        language,
        voiceId,
      });

      const existingReady = await voiceRepository.findReadyByHash({
        contentType: target.contentType,
        language,
        voiceId,
        textHash,
      });

      const asset = await voiceRepository.upsertPendingOrReuse({
        contentType: target.contentType,
        contentId: question.id,
        language,
        voiceId,
        textHash,
        transcript: target.transcript,
        reusedAudioUrl: existingReady?.audioUrl ?? null,
      });

      if (asset.status === VoiceAssetStatus.PENDING) {
        await jobDispatcher.enqueueVoiceGeneration({ voiceAssetId: asset.id });
      }
      assets.push(asset);
    }

    return assets;
  }

  async processVoiceGenerationJob(voiceAssetId: string): Promise<void> {
    const asset = await voiceRepository.findById(voiceAssetId);
    if (!asset || asset.status === VoiceAssetStatus.READY) {
      return;
    }

    // Double-check cache reuse by textHash before calling external TTS
    const cached = await voiceRepository.findReadyByHash({
      contentType: asset.contentType,
      language: asset.language,
      voiceId: asset.voiceId,
      textHash: asset.textHash,
    });
    if (cached?.audioUrl) {
      await voiceRepository.markReady(asset.id, cached.audioUrl, asset.attempts);
      return;
    }

    const nextAttempt = asset.attempts + 1;
    try {
      const result = await this.ttsProvider.synthesize({
        text: asset.transcript,
        language: asset.language,
        voiceId: asset.voiceId,
        assetId: asset.id,
      });
      await voiceRepository.markReady(asset.id, result.audioUrl, nextAttempt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown TTS error';
      await voiceRepository.markAttemptError(asset.id, nextAttempt, msg, nextAttempt >= 3);
      throw err;
    }
  }

  async getQuestionPromptAudio(questionId: string, language?: string, voiceId?: string) {
    const question = await questionRepository.findById(questionId);
    if (!question || question.status !== QuestionStatus.APPROVED) {
      throw new NotFoundError('Approved question not found');
    }

    const lang = language ?? env.TTS_DEFAULT_LANGUAGE;
    const voice = voiceId ?? env.TTS_DEFAULT_VOICE_ID;
    const transcript = buildQuestionPromptTranscript(question);
    const textHash = computeTtsTextHash({
      contentType: VoiceContentType.QUESTION_PROMPT,
      transcript,
      language: lang,
      voiceId: voice,
    });

    const asset = await voiceRepository.findByUniqueKey({
      contentType: VoiceContentType.QUESTION_PROMPT,
      contentId: question.id,
      language: lang,
      voiceId: voice,
      textHash,
    });

    if (!asset) {
      throw new NotFoundError('Prompt voice asset not generated yet');
    }

    return {
      questionId: question.id,
      contentType: asset.contentType,
      language: asset.language,
      voiceId: asset.voiceId,
      status: asset.status,
      audioUrl: asset.audioUrl,
      transcript: asset.transcript,
    };
  }

  /**
   * Explanation audio is strictly gated: returns 403 until the user
   * has submitted an answer to that question.
   */
  async getQuestionExplanationAudio(
    userId: string,
    questionId: string,
    language?: string,
    voiceId?: string,
  ) {
    const question = await questionRepository.findById(questionId);
    if (!question || question.status !== QuestionStatus.APPROVED) {
      throw new NotFoundError('Approved question not found');
    }

    const hasAnswered = await attemptRepository.hasUserAnsweredQuestion(userId, questionId);
    if (!hasAnswered) {
      throw new ForbiddenError(
        'Explanation audio is locked until you submit an answer to this question',
        'EXPLANATION_AUDIO_LOCKED',
      );
    }

    const lang = language ?? env.TTS_DEFAULT_LANGUAGE;
    const voice = voiceId ?? env.TTS_DEFAULT_VOICE_ID;
    const transcript = buildExplanationTranscript(question);
    const textHash = computeTtsTextHash({
      contentType: VoiceContentType.EXPLANATION,
      transcript,
      language: lang,
      voiceId: voice,
    });

    const asset = await voiceRepository.findByUniqueKey({
      contentType: VoiceContentType.EXPLANATION,
      contentId: question.id,
      language: lang,
      voiceId: voice,
      textHash,
    });

    if (!asset) {
      throw new NotFoundError('Explanation voice asset not generated yet');
    }

    return {
      questionId: question.id,
      contentType: asset.contentType,
      language: asset.language,
      voiceId: asset.voiceId,
      status: asset.status,
      audioUrl: asset.audioUrl,
      transcript: asset.transcript,
    };
  }

  async queueVoiceForAristotleTemplate(template: {
    id: string;
    key: string;
    body: string;
    language: string;
    voiceId: string;
  }) {
    const transcript = template.body.trim();
    const textHash = computeTtsTextHash({
      contentType: VoiceContentType.ARISTOTLE_TEMPLATE,
      transcript,
      language: template.language,
      voiceId: template.voiceId,
    });

    const existingReady = await voiceRepository.findReadyByHash({
      contentType: VoiceContentType.ARISTOTLE_TEMPLATE,
      language: template.language,
      voiceId: template.voiceId,
      textHash,
    });

    const asset = await voiceRepository.upsertPendingOrReuse({
      contentType: VoiceContentType.ARISTOTLE_TEMPLATE,
      contentId: template.key,
      language: template.language,
      voiceId: template.voiceId,
      textHash,
      transcript,
      reusedAudioUrl: existingReady?.audioUrl ?? null,
    });

    if (asset.status === VoiceAssetStatus.PENDING) {
      await jobDispatcher.enqueueVoiceGeneration({ voiceAssetId: asset.id });
    }
    return asset;
  }
}

export const voiceService = new VoiceService();
