import { Request, Response } from 'express';
import { authService } from '../services/auth.service.ts';

export class AuthController {
  async register(req: Request, res: Response): Promise<void> {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  }

  async login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(req.body);
    res.status(200).json(result);
  }

  async refresh(req: Request, res: Response): Promise<void> {
    const result = await authService.refresh(req.body.refreshToken);
    res.status(200).json(result);
  }

  async logout(req: Request, res: Response): Promise<void> {
    await authService.logout(req.body.refreshToken);
    res.status(204).send();
  }
}

export const authController = new AuthController();
