import type { Request, Response } from 'express';
import { gbpConfigStatus } from '../config/gbp';

/** Admin only. Reports whether the Google Business Profile settings are well-formed; never returns a secret. */
export function adminGbpConfig(_req: Request, res: Response): void {
  res.json(gbpConfigStatus());
}
