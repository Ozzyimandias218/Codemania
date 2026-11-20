import { Router } from 'express';
import { voiceController } from '../controllers/voice.controller.ts';
import { requireAuth } from '../middleware/auth.middleware.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';

export const voiceRouter = Router();

voiceRouter.use(requireAuth);

voiceRouter.get(
  '/:id/audio',
  asyncHandler((req, res) => voiceController.getPromptAudio(req, res)),
);

voiceRouter.get(
  '/:id/explanation-audio',
  asyncHandler((req, res) => voiceController.getExplanationAudio(req, res)),
);
