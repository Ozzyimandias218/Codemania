import { NextFunction, Request, Response } from 'express';
import { ZodTypeAny } from 'zod';
import { BadRequestError } from '../utils/errors.ts';

export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new BadRequestError('Validation failed', 'VALIDATION_ERROR', parsed.error.issues),
      );
      return;
    }
    req.body = parsed.data;
    next();
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      next(
        new BadRequestError('Query validation failed', 'VALIDATION_ERROR', parsed.error.issues),
      );
      return;
    }
    req.query = parsed.data as Request['query'];
    next();
  };
}
