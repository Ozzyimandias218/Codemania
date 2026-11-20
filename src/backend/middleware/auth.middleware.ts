import { UserRole } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import { authService } from '../services/auth.service.ts';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.ts';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: UserRole;
  };
}

export function requireAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing Bearer authorization header'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    const payload = authService.verifyAccessToken(token);
    req.user = {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new UnauthorizedError());
    return;
  }
  if (req.user.role !== UserRole.ADMIN) {
    next(new ForbiddenError('Admin privileges required', 'ADMIN_REQUIRED'));
    return;
  }
  next();
}
