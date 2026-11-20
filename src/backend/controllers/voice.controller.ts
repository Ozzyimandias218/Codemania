import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.ts';
import { voiceService } from '../services/tts/voice.service.ts';

export class VoiceController {
  async getPromptAudio(req: AuthenticatedRequest, res: Response): Promise<void> {
    const language = typeof req.query.language === 'string' ? req.query.language : undefined;
    const voiceId = typeof req.query.voiceId === 'string' ? req.query.voiceId : undefined;
    const data = await voiceService.getQuestionPromptAudio(req.params.id, language, voiceId);
    res.status(200).json(data);
  }

  async getExplanationAudio(req: AuthenticatedRequest, res: Response): Promise<void> {
    const language = typeof req.query.language === 'string' ? req.query.language : undefined;
    const voiceId = typeof req.query.voiceId === 'string' ? req.query.voiceId : undefined;
    const data = await voiceService.getQuestionExplanationAudio(
      req.user!.userId,
      req.params.id,
      language,
      voiceId,
    );
    res.status(200).json(data);
  }
}

export const voiceController = new VoiceController();
