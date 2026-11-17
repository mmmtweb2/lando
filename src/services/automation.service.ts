// What the customer lets us do by ourselves, and the log of what we did (docs/mvp-plan.md, A4;
// migration 048). The whole automatic product is OFF unless AUTOPILOT_ENABLED=true: with the switch
// off nothing here publishes anything, and the screens still work (cards can be read and approved).

import { supabase } from '../config/supabase';

export type PostsMode = 'auto' | 'approve' | 'off';
export type RepliesMode = 'auto_positive' | 'approve' | 'off';
/** What happens to the Google listing's website when the business's own page is published (migration 050). */
export type WebsiteMode = 'auto' | 'ask' | 'off';
export interface Automation { postsMode: PostsMode; repliesMode: RepliesMode; websiteMode: WebsiteMode; consentAt: string | null }

export const POSTS_MODES: PostsMode[] = ['auto', 'approve', 'off'];
export const REPLIES_MODES: RepliesMode[] = ['auto_positive', 'approve', 'off'];
export const WEBSITE_MODES: WebsiteMode[] = ['auto', 'ask', 'off'];
/** What an account gets before it chose anything. Nothing runs without consentAt. */
export const DEFAULT_AUTOMATION: Automation = { postsMode: 'auto', repliesMode: 'auto_positive', websiteMode: 'auto', consentAt: null };

export const autopilotEnabled = (): boolean => process.env.AUTOPILOT_ENABLED === 'true';
export const missingTable = (m?: string, code?: string): boolean => code === '42P01' || /does not exist|schema cache|PGRST205/i.test(m ?? '');

/** Before migration 050 the website_mode column does not exist: never let that look like "no row" (it would drop the consent). */
const noWebsiteCol = (e: { message?: string; code?: string } | null): boolean => !!e && (e.code === '42703' || /website_mode/.test(e.message ?? ''));

export async function getAutomation(email: string): Promise<Automation> {
  let { data, error } = await supabase.from('seo_automation').select('posts_mode, replies_mode, consent_at, website_mode').eq('owner_email', email).maybeSingle();
  if (noWebsiteCol(error)) ({ data, error } = await supabase.from('seo_automation').select('posts_mode, replies_mode, consent_at').eq('owner_email', email).maybeSingle());
  if (error) { if (missingTable(error.message, error.code)) return DEFAULT_AUTOMATION; throw new Error(error.message); }
  const r = data as { posts_mode: PostsMode; replies_mode: RepliesMode; consent_at: string | null; website_mode?: WebsiteMode | null } | null;
  return r ? { postsMode: r.posts_mode, repliesMode: r.replies_mode, websiteMode: r.website_mode && WEBSITE_MODES.includes(r.website_mode) ? r.website_mode : 'auto', consentAt: r.consent_at } : DEFAULT_AUTOMATION;
}

/** Saves the customer's choice. `consent: true` stamps the moment they agreed to automatic publishing. */
export async function setAutomation(email: string, patch: { postsMode?: PostsMode; repliesMode?: RepliesMode; websiteMode?: WebsiteMode; consent?: boolean }, now = new Date()): Promise<Automation> {
  const cur = await getAutomation(email);
  const next: Automation = {
    postsMode: patch.postsMode ?? cur.postsMode,
    repliesMode: patch.repliesMode ?? cur.repliesMode,
    websiteMode: patch.websiteMode ?? cur.websiteMode,
    consentAt: patch.consent ? (cur.consentAt ?? now.toISOString()) : cur.consentAt,
  };
  const base = { owner_email: email, posts_mode: next.postsMode, replies_mode: next.repliesMode, consent_at: next.consentAt, updated_at: now.toISOString() };
  let { error } = await supabase.from('seo_automation').upsert({ ...base, website_mode: next.websiteMode }, { onConflict: 'owner_email' });
  if (noWebsiteCol(error)) {
    if (patch.websiteMode) throw new Error('website_mode needs migration 050');
    ({ error } = await supabase.from('seo_automation').upsert(base, { onConflict: 'owner_email' }));
  }
  if (error) throw new Error(error.message);
  return next;
}

// ── Activity log ─────────────────────────────────────────────────────────────

export type ActivityKind =
  | 'card_synced' | 'card_approved'
  | 'post_planned' | 'post_published' | 'post_skipped' | 'post_failed'
  | 'reply_published' | 'reply_drafted'
  | 'page_created'
  // docs/gbp-sync-spec.md: what we changed in the customer's Google listing.
  | 'card_field_synced' | 'photo_added' | 'photo_removed';
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
