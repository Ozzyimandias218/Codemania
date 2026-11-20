import { VoiceAssetStatus, VoiceContentType } from '@prisma/client';
import { prisma } from '../config/prisma.ts';

export class VoiceRepository {
  async findByUniqueKey(params: {
    contentType: VoiceContentType;
    contentId: string;
    language: string;
    voiceId: string;
    textHash: string;
  }) {
    return prisma.voiceAsset.findUnique({
      where: {
        contentType_contentId_language_voiceId_textHash: params,
      },
    });
  }

  async findReadyByHash(params: {
    contentType: VoiceContentType;
    language: string;
    voiceId: string;
    textHash: string;
  }) {
    return prisma.voiceAsset.findFirst({
      where: {
        contentType: params.contentType,
        language: params.language,
        voiceId: params.voiceId,
        textHash: params.textHash,
        status: VoiceAssetStatus.READY,
      },
    });
  }

  async findLatestForContent(params: {
    contentType: VoiceContentType;
    contentId: string;
    language: string;
    voiceId: string;
  }) {
    return prisma.voiceAsset.findFirst({
      where: params,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async upsertPendingOrReuse(data: {
    contentType: VoiceContentType;
    contentId: string;
    language: string;
    voiceId: string;
    textHash: string;
    transcript: string;
    reusedAudioUrl?: string | null;
  }) {
    const status = data.reusedAudioUrl ? VoiceAssetStatus.READY : VoiceAssetStatus.PENDING;
    return prisma.voiceAsset.upsert({
      where: {
        contentType_contentId_language_voiceId_textHash: {
          contentType: data.contentType,
          contentId: data.contentId,
          language: data.language,
          voiceId: data.voiceId,
          textHash: data.textHash,
        },
      },
      create: {
        contentType: data.contentType,
        contentId: data.contentId,
        language: data.language,
        voiceId: data.voiceId,
        textHash: data.textHash,
        transcript: data.transcript,
        audioUrl: data.reusedAudioUrl ?? null,
        status,
      },
      update: {
        transcript: data.transcript,
        ...(data.reusedAudioUrl
          ? { audioUrl: data.reusedAudioUrl, status: VoiceAssetStatus.READY }
          : {}),
      },
    });
  }

  async findById(id: string) {
    return prisma.voiceAsset.findUnique({ where: { id } });
  }

  async markReady(id: string, audioUrl: string, attempts: number) {
    return prisma.voiceAsset.update({
      where: { id },
      data: {
        status: VoiceAssetStatus.READY,
        audioUrl,
        attempts,
        lastError: null,
      },
    });
  }

  async markAttemptError(id: string, attempts: number, errorMessage: string, isFinal: boolean) {
    return prisma.voiceAsset.update({
      where: { id },
      data: {
        status: isFinal ? VoiceAssetStatus.FAILED : VoiceAssetStatus.PENDING,
        attempts,
        lastError: errorMessage,
      },
    });
  }
}

export const voiceRepository = new VoiceRepository();
