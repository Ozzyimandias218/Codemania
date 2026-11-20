import express, { RequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { errorHandler } from './middleware/error.middleware.ts';
import { adminRouter } from './routes/admin.routes.ts';
import { aristotleRouter } from './routes/aristotle.routes.ts';
import { attemptRouter, levelAttemptRouter } from './routes/attempt.routes.ts';
import { authRouter } from './routes/auth.routes.ts';
import { commitmentRouter } from './routes/commitment.routes.ts';
import { dailyRouter, leaderboardRouter } from './routes/dailyQuiz.routes.ts';
import { meRouter } from './routes/me.routes.ts';
import { trackRouter } from './routes/track.routes.ts';
import { voiceRouter } from './routes/voice.routes.ts';
import { webhookRouter } from './routes/webhook.routes.ts';
import { createSandboxFallbackRouter } from './runtime/sandboxFallback.ts';

export interface CreateAppOptions {
  useSandboxFallback?: boolean;
  frontendMiddleware?: RequestHandler;
  staticDistDir?: string;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.set('trust proxy', 1);

  // Stripe webhook requires raw body for signature verification BEFORE express.json()
  app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

  app.use(express.json({ limit: '8mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'codemania-backend',
      storage: options.useSandboxFallback ? 'sandbox-memory' : 'postgresql',
    });
  });

  app.use('/api/aristotle', aristotleRouter);

  if (options.useSandboxFallback) {
    app.use(createSandboxFallbackRouter());
  } else {
    app.use('/auth', authRouter);
    app.use('/tracks', trackRouter);
    app.use('/levels', levelAttemptRouter);
    app.use('/attempts', attemptRouter);
    app.use('/me', meRouter);
    app.use('/commitments', commitmentRouter);
    app.use('/questions', voiceRouter);
    app.use('/daily', dailyRouter);
    app.use('/leaderboard', leaderboardRouter);
    app.use('/admin', adminRouter);
  }

  if (options.frontendMiddleware) {
    app.use(options.frontendMiddleware);
  } else if (options.staticDistDir && fs.existsSync(options.staticDistDir)) {
    app.use(express.static(options.staticDistDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(options.staticDistDir!, 'index.html'));
    });
  } else {
    app.use((_req, res) => {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    });
  }

  app.use(errorHandler);
  return app;
}
