import { supabase } from '../config/supabase';

// Review requests (migration 035). The owner sends every message from their own WhatsApp; this
// file only remembers who was asked and when, and decides what the next step for a person is.

export const MAX_PER_BUSINESS = 200;
export const FOLLOWUP_AFTER_DAYS = 7;
export type Status = 'new' | 'sent' | 'reviewed';
export type Next = 'send' | 'wait' | 'followup' | 'done';

export class RRError extends Error {
  constructor(public readonly code: 'bad_input' | 'bad_phone' | 'limit' | 'duplicate' | 'not_found' | 'not_migrated' | 'too_soon' | 'db', message?: string) { super(message ?? code); }
}
function wrap(e: { code?: string; message: string }): RRError {
  return e.code === '42P01' ? new RRError('not_migrated') : new RRError('db', e.message);
}

export interface Row {
  id: string; business_id: string; first_name: string; phone: string; status: Status;
  sent_at: string | null; followup_sent_at: string | null; created_at: string;
}
export interface View extends Row { next: Next; waitDays: number }

/** Israeli mobile only (05X…, +9725X…, 9725X…) -> 9725XXXXXXXX. Anything else is refused. */
export function normalizePhone(v: unknown): string {
  if (typeof v !== 'string') throw new RRError('bad_phone');
  let d = v.replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = '972' + d.slice(1);
  if (!/^9725\d{8}$/.test(d)) throw new RRError('bad_phone');
  return d;
}

export function cleanName(v: unknown): string {
  if (typeof v !== 'string') throw new RRError('bad_input');
  const n = v.replace(/\s+/g, ' ').trim();
  if (n.length < 1 || n.length > 40 || /[<>]/.test(n)) throw new RRError('bad_input');
  return n;
}

/** What may happen next with this person. At most two messages ever: the request and one reminder. */
export function nextStep(r: Pick<Row, 'status' | 'sent_at' | 'followup_sent_at'>, now = new Date()): { next: Next; waitDays: number } {
  if (r.status === 'reviewed') return { next: 'done', waitDays: 0 };
  if (!r.sent_at) return { next: 'send', waitDays: 0 };
  if (r.followup_sent_at) return { next: 'done', waitDays: 0 };
  const elapsed = (now.getTime() - new Date(r.sent_at).getTime()) / 86400000;
  if (elapsed >= FOLLOWUP_AFTER_DAYS) return { next: 'followup', waitDays: 0 };
  return { next: 'wait', waitDays: Math.ceil(FOLLOWUP_AFTER_DAYS - elapsed) };
}

const COLS = 'id, business_id, first_name, phone, status, sent_at, followup_sent_at, created_at';
const withNext = (r: Row, now: Date): View => ({ ...r, ...nextStep(r, now) });

async function ownsBusiness(email: string, businessId: string): Promise<boolean> {
  const { data, error } = await supabase.from('seo_businesses').select('id').eq('id', businessId).eq('owner_email', email).maybeSingle();
  if (error) throw wrap(error);
  return !!data;
}

export async function list(email: string, businessId: string, now = new Date()): Promise<View[]> {
  if (!(await ownsBusiness(email, businessId))) throw new RRError('not_found');
  const { data, error } = await supabase.from('review_requests').select(COLS)
    .eq('owner_email', email).eq('business_id', businessId).order('created_at', { ascending: false }).limit(MAX_PER_BUSINESS);
  if (error) throw wrap(error);
  return ((data ?? []) as Row[]).map((r) => withNext(r, now));
}

export async function add(email: string, businessId: string, name: unknown, phone: unknown, now = new Date()): Promise<View> {
  const first_name = cleanName(name);
  const p = normalizePhone(phone);
  if (!(await ownsBusiness(email, businessId))) throw new RRError('not_found');
  const { count, error: cErr } = await supabase.from('review_requests').select('id', { count: 'exact', head: true }).eq('business_id', businessId);
  if (cErr) throw wrap(cErr);
  if ((count ?? 0) >= MAX_PER_BUSINESS) throw new RRError('limit');
  const { data, error } = await supabase.from('review_requests')
    .insert({ owner_email: email, business_id: businessId, first_name, phone: p }).select(COLS).single();
  if (error) { if (error.code === '23505') throw new RRError('duplicate'); throw wrap(error); }
  return withNext(data as Row, now);
}

async function mine(email: string, id: string): Promise<Row> {
  const { data, error } = await supabase.from('review_requests').select(COLS).eq('id', id).eq('owner_email', email).maybeSingle();
  if (error) throw wrap(error);
  if (!data) throw new RRError('not_found');
  return data as Row;
}

/** The owner tapped "send" (first request, or the single reminder). Refuses anything not allowed yet. */
export async function markSent(email: string, id: string, now = new Date()): Promise<View> {
  const r = await mine(email, id);
  const step = nextStep(r, now);
  const patch: Record<string, unknown> = {};
  if (step.next === 'send') { patch.sent_at = now.toISOString(); patch.status = 'sent'; }
  else if (step.next === 'followup') { patch.followup_sent_at = now.toISOString(); }
  else throw new RRError('too_soon');
  const { error } = await supabase.from('review_requests').update(patch).eq('id', id).eq('owner_email', email);
  if (error) throw wrap(error);
  return withNext({ ...r, ...patch } as Row, now);
}

export async function markReviewed(email: string, id: string, now = new Date()): Promise<View> {
  const r = await mine(email, id);
  const { error } = await supabase.from('review_requests').update({ status: 'reviewed' }).eq('id', id).eq('owner_email', email);
  if (error) throw wrap(error);
  return withNext({ ...r, status: 'reviewed' }, now);
}

export async function remove(email: string, id: string): Promise<void> {
  await mine(email, id);
  const { error } = await supabase.from('review_requests').delete().eq('id', id).eq('owner_email', email);
  if (error) throw wrap(error);
}
