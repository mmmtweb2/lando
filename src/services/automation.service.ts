// What the customer lets us do by ourselves, and the log of what we did (docs/mvp-plan.md, A4;
// migration 048). The whole automatic product is OFF unless AUTOPILOT_ENABLED=true: with the switch
// off nothing here publishes anything, and the screens still work (cards can be read and approved).

import { supabase } from '../config/supabase';

export type PostsMode = 'auto' | 'approve' | 'off';
export type RepliesMode = 'auto_positive' | 'approve' | 'off';
export interface Automation { postsMode: PostsMode; repliesMode: RepliesMode; consentAt: string | null }

export const POSTS_MODES: PostsMode[] = ['auto', 'approve', 'off'];
export const REPLIES_MODES: RepliesMode[] = ['auto_positive', 'approve', 'off'];
/** What an account gets before it chose anything. Nothing runs without consentAt. */
export const DEFAULT_AUTOMATION: Automation = { postsMode: 'auto', repliesMode: 'auto_positive', consentAt: null };

export const autopilotEnabled = (): boolean => process.env.AUTOPILOT_ENABLED === 'true';
export const missingTable = (m?: string, code?: string): boolean => code === '42P01' || /does not exist|schema cache|PGRST205/i.test(m ?? '');

export async function getAutomation(email: string): Promise<Automation> {
  const { data, error } = await supabase.from('seo_automation').select('posts_mode, replies_mode, consent_at').eq('owner_email', email).maybeSingle();
  if (error) { if (missingTable(error.message, error.code)) return DEFAULT_AUTOMATION; throw new Error(error.message); }
  const r = data as { posts_mode: PostsMode; replies_mode: RepliesMode; consent_at: string | null } | null;
  return r ? { postsMode: r.posts_mode, repliesMode: r.replies_mode, consentAt: r.consent_at } : DEFAULT_AUTOMATION;
}

/** Saves the customer's choice. `consent: true` stamps the moment they agreed to automatic publishing. */
export async function setAutomation(email: string, patch: { postsMode?: PostsMode; repliesMode?: RepliesMode; consent?: boolean }, now = new Date()): Promise<Automation> {
  const cur = await getAutomation(email);
  const next: Automation = {
    postsMode: patch.postsMode ?? cur.postsMode,
    repliesMode: patch.repliesMode ?? cur.repliesMode,
    consentAt: patch.consent ? (cur.consentAt ?? now.toISOString()) : cur.consentAt,
  };
  const { error } = await supabase.from('seo_automation').upsert({
    owner_email: email, posts_mode: next.postsMode, replies_mode: next.repliesMode, consent_at: next.consentAt, updated_at: now.toISOString(),
  }, { onConflict: 'owner_email' });
  if (error) throw new Error(error.message);
  return next;
}

// ── Activity log ─────────────────────────────────────────────────────────────

export type ActivityKind =
  | 'card_synced' | 'card_approved'
  | 'post_planned' | 'post_published' | 'post_skipped'
  | 'reply_published' | 'reply_drafted'
  | 'page_created';
export interface Activity { id: string; kind: ActivityKind; title: string; detail: string | null; createdAt: string }

/**
 * One line in the customer's log. Best effort: a failed log line never fails the action it
 * describes. With a `ref` the same event is written once (unique index), so retries are safe.
 */
export async function logActivity(email: string, kind: ActivityKind, title: string, detail: string | null = null, ref: string | null = null): Promise<void> {
  try {
    const { error } = await supabase.from('seo_activity').insert({ owner_email: email, kind, title: title.slice(0, 200), detail: detail ? detail.slice(0, 600) : null, ref });
    if (error && error.code !== '23505' && !missingTable(error.message, error.code)) console.error('[ACTIVITY] insert failed:', error.message.slice(0, 160));
  } catch (e) { console.error('[ACTIVITY] insert crashed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown'); }
}

export async function listActivity(email: string, limit = 30): Promise<Activity[]> {
  const { data, error } = await supabase.from('seo_activity').select('id, kind, title, detail, created_at')
    .eq('owner_email', email).order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 100));
  if (error) { if (missingTable(error.message, error.code)) return []; throw new Error(error.message); }
  return ((data ?? []) as { id: string; kind: ActivityKind; title: string; detail: string | null; created_at: string }[])
    .map((r) => ({ id: r.id, kind: r.kind, title: r.title, detail: r.detail, createdAt: r.created_at }));
}
