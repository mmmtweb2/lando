import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  const { error } = await supabase
    .from('landing_pages')
    .select('*', { count: 'exact', head: true });

  if (error && error.code !== 'PGRST116') {
    res.status(503).json({ status: 'error', db: 'unreachable', message: error.message });
    return;
  }

  res.json({ status: 'ok', db: 'connected' });
}
