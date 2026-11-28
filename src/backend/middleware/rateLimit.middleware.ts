import rateLimit from 'express-rate-limit';
import { env } from '../config/env.ts';

export const authRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
  max: env.RATE_LIMIT_AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many authentication requests, please try again later.',
    },
  },
});

export const answerRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_ANSWER_WINDOW_MS,
  max: env.RATE_LIMIT_ANSWER_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many answer submissions, please slow down.',
    },
  },
});

export const tutorRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many AI tutor requests. Please wait a minute and try again.',
    },
  },
});
