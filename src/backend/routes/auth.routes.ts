import { Router } from 'express';
import { z } from 'zod';
import { authController } from '../controllers/auth.controller.ts';
import { asyncHandler } from '../middleware/error.middleware.ts';
import { authRateLimiter } from '../middleware/rateLimit.middleware.ts';
import { validateBody } from '../middleware/validate.middleware.ts';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().min(1).max(64).optional(),
  isAdult: z.boolean(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const authRouter = Router();

authRouter.post(
  '/register',
  authRateLimiter,
  validateBody(registerSchema),
  asyncHandler((req, res) => authController.register(req, res)),
);

authRouter.post(
  '/login',
  authRateLimiter,
  validateBody(loginSchema),
  asyncHandler((req, res) => authController.login(req, res)),
);

authRouter.post(
  '/refresh',
  authRateLimiter,
  validateBody(refreshSchema),
  asyncHandler((req, res) => authController.refresh(req, res)),
);

authRouter.post(
  '/logout',
  validateBody(refreshSchema),
  asyncHandler((req, res) => authController.logout(req, res)),
);
