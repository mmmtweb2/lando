import { supabase } from '../config/supabase';

export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const MAX_MESSAGE = 2000;
export const DAILY_LIMIT = 10;

export class FeedbackError extends Error {
  constructor(public readonly code: 'bad_input' | 'too_many' | 'not_migrated' | 'db', message?: string) { super(message ?? code); }
}

function wrap(e: { code?: string; message: string }): FeedbackError {
  return e.code === '42P01' ? new FeedbackError('not_migrated') : new FeedbackError('db', e.message);
}

export interface FeedbackRow {
  id: string; email: string; kind: FeedbackKind; message: string; page: string | null; seen: boolean; created_at: string;
}

export function cleanInput(kind: unknown, message: unknown, page: unknown): { kind: FeedbackKind; message: string; page: string | null } {
  const k: FeedbackKind = typeof kind === 'string' && (FEEDBACK_KINDS as readonly string[]).includes(kind) ? (kind as FeedbackKind) : 'other';
  if (typeof message !== 'string') throw new FeedbackError('bad_input');
  const m = message.replace(/\r\n/g, '\n').trim();
  if (m.length < 3 || m.length > MAX_MESSAGE) throw new FeedbackError('bad_input');
  // `page` is only a short label of where the person was (e.g. "profile"); never a URL with data.
  const p = typeof page === 'string' && /^[a-z0-9_-]{1,30}$/i.test(page) ? page : null;
  return { kind: k, message: m, page: p };
}

export async function addFeedback(email: string, kind: unknown, message: unknown, page: unknown, now = new Date()): Promise<FeedbackRow> {
  const c = cleanInput(kind, message, page);
  const since = new Date(now.getTime() - 86400000).toISOString();
  const { count, error: cErr } = await supabase.from('seo_feedback')
    .select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', since);
  if (cErr) throw wrap(cErr);
  if ((count ?? 0) >= DAILY_LIMIT) throw new FeedbackError('too_many');
  const { data, error } = await supabase.from('seo_feedback')
    .insert({ email, kind: c.kind, message: c.message, page: c.page })
    .select('id, email, kind, message, page, seen, created_at').single();
  if (error || !data) throw wrap(error ?? { message: 'insert failed' });
  return data as FeedbackRow;
}

export async function listFeedback(limit = 200): Promise<FeedbackRow[]> {
  const { data, error } = await supabase.from('seo_feedback')
    .select('id, email, kind, message, page, seen, created_at').order('created_at', { ascending: false }).limit(limit);
  if (error) throw wrap(error);
  return (data ?? []) as FeedbackRow[];
}

export async function setSeen(id: string, seen: boolean): Promise<void> {
  const { error } = await supabase.from('seo_feedback').update({ seen }).eq('id', id);
  if (error) throw wrap(error);
}
