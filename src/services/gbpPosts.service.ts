// Weekly Google posts: the sweep and the owner's actions (docs/mvp-plan.md, A2; migration 048).
//
// OFF unless AUTOPILOT_ENABLED=true. For every paying account that connected its Google card,
// approved its business details and did not switch posts off:
//   1. once a week a post is written from the approved details and scheduled 48 hours ahead;
//   2. the owner can read, edit, publish now or skip it in the dashboard;
//   3. in "auto" mode it is published when the 48 hours pass (never on Shabbat or at night);
//      in "approve" mode only after the owner pressed publish.
//
//   • Idempotent: (owner_email, week_key) is unique, and a post is claimed (scheduled -> publishing)
//     before the Google call, so two sweeps or two server instances cannot publish it twice.
//   • The Business Profile API quota is 0 until Google approves access: publishing then fails with
//     429, the post stays scheduled and the sweep tries again later without counting an attempt.
//   • UNVERIFIED against live Google until that access exists: covered by tests with fake responses.

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../config/supabase';
import { GbpError, createLocalPost, listLocations } from './gbpGoogle';
import { getConnection, markNeedsReconnect } from './gbpStore';
import { accessFor } from './reviewAlerts.service';
import { isEntitled } from './entitlements.service';
import { recordHeartbeat, withHeartbeat } from './opsMetrics.service';
import { type PostsMode, autopilotEnabled, getAutomation, logActivity, missingTable } from './automation.service';
import { type TruthCard, emptyCard } from './businessTruth';
import {
  MAX_ATTEMPTS, POST_SYSTEM, RETRY_HOURS, STALE_DAYS, cleanPost, ctaFor, fallbackPost, pickTopic, postPrompt, publishAfter, quietNow, weekKey,
} from './gbpPosts';

const HOUR = 3_600_000;
const SWEEP_EVERY_MS = 3 * HOUR;
const MAX_ACCOUNTS_PER_SWEEP = 100;

export type PostStatus = 'scheduled' | 'publishing' | 'published' | 'skipped' | 'failed';
export interface PostRow {
  id: string; owner_email: string; location_name: string; week_key: string; topic: string; body: string; cta: 'CALL' | 'LEARN_MORE' | null;
  status: PostStatus; edited: boolean; approved: boolean; publish_after: string; published_at: string | null; attempts: number; last_error: string | null; created_at: string;
}
const COLS = 'id, owner_email, location_name, week_key, topic, body, cta, status, edited, approved, publish_after, published_at, attempts, last_error, created_at';

export interface PostContext { card: TruthCard; location: string; mode: PostsMode; recent: PostRow[] }
export interface SweepDeps {
  accounts(now: Date): Promise<string[]>;
  context(email: string): Promise<PostContext | null>;
  write(card: TruthCard, system: string, prompt: string): Promise<string | null>;
  create(row: Pick<PostRow, 'owner_email' | 'location_name' | 'week_key' | 'topic' | 'body' | 'cta' | 'publish_after'>): Promise<PostRow | null>;
  due(email: string, now: Date): Promise<PostRow[]>;
  claim(id: string): Promise<boolean>;
  send(email: string, row: PostRow, website: string): Promise<string | null>;
  finish(id: string, patch: Partial<PostRow> & { google_name?: string | null }): Promise<void>;
  expire(email: string, before: Date): Promise<void>;
  log: typeof logActivity;
}
export interface SweepResult { accounts: number; planned: number; published: number; waiting: number; failed: number }

/** Writes this week's text: the model's when it passes every check, otherwise the plain true one. */
export async function writePost(card: TruthCard, recent: PostRow[], write: SweepDeps['write']): Promise<{ topic: string; body: string } | null> {
  const topic = pickTopic(card, recent.map((r) => r.topic));
  if (!topic) return null;
  let body: string | null = null;
  try { body = cleanPost(await write(card, POST_SYSTEM, postPrompt(card, topic, recent.map((r) => r.body))), card); } catch (e) {
    console.error('[POSTS] writer failed, using the plain text:', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
  }
  body = body ?? cleanPost(fallbackPost(card, topic), card);
  return body ? { topic: topic.key, body } : null;
}

export async function sweepPosts(now = new Date(), deps: SweepDeps = realDeps): Promise<SweepResult> {
  const out: SweepResult = { accounts: 0, planned: 0, published: 0, waiting: 0, failed: 0 };
  if (!autopilotEnabled()) return out;
  for (const email of (await deps.accounts(now)).slice(0, MAX_ACCOUNTS_PER_SWEEP)) {
    out.accounts++;
    try {
      const ctx = await deps.context(email);
      if (!ctx || ctx.mode === 'off') continue;
      await deps.expire(email, new Date(now.getTime() - STALE_DAYS * 24 * HOUR));

      // 1. This week's post, once.
      const wk = weekKey(now);
      if (!ctx.recent.some((r) => r.week_key === wk)) {
        const w = await writePost(ctx.card, ctx.recent, deps.write);
        if (w) {
          const row = await deps.create({ owner_email: email, location_name: ctx.location, week_key: wk, topic: w.topic, body: w.body, cta: ctaFor(ctx.card), publish_after: publishAfter(now).toISOString() });
          if (row) {
            out.planned++;
            await deps.log(email, 'post_planned', 'כתבנו את הפוסט השבועי לכרטיס העסק שלכם', ctx.mode === 'auto' ? 'הוא יתפרסם בעוד יומיים. עד אז אפשר לקרוא, לערוך או לעצור אותו.' : 'הוא מחכה לאישור שלכם.', `post:${row.id}`);
          }
        }
      }

      // 2. Publish what is due.
      for (const p of await deps.due(email, now)) {
        // Not approved by the owner: only in auto mode, and never at a quiet time. A post the owner
        // already approved (publish pressed while Google was unavailable) goes out as soon as it can.
        if (!p.approved && (ctx.mode !== 'auto' || quietNow(now))) { out.waiting++; continue; }
        if (!(await deps.claim(p.id))) continue;
        try {
          const name = await deps.send(email, p, ctx.card.website);
          await deps.finish(p.id, { status: 'published', published_at: now.toISOString(), google_name: name, last_error: null });
          out.published++;
          await deps.log(email, 'post_published', 'פרסמנו פוסט בכרטיס העסק שלכם בגוגל', p.body.slice(0, 160), `published:${p.id}`);
          void recordHeartbeat('gbp_google', null);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const quota = /http_429/.test(msg);
          const attempts = p.attempts + (quota ? 0 : 1);
          const dead = attempts >= MAX_ATTEMPTS || (e instanceof GbpError && e.code === 'revoked');
          await deps.finish(p.id, {
            status: dead ? 'failed' : 'scheduled', attempts, last_error: quota ? 'google quota pending' : msg.slice(0, 200),
            ...(dead ? {} : { publish_after: new Date(now.getTime() + RETRY_HOURS * HOUR).toISOString() }),
          });
          if (quota) out.waiting++; else out.failed++;
          void recordHeartbeat('gbp_google', quota ? 'google quota pending' : msg.slice(0, 120));
        }
      }
    } catch (e) {
      out.failed++;
      console.error('[POSTS] one account failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    }
  }
  if (out.planned || out.published || out.failed) console.log('[POSTS] sweep', out);
  return out;
}

// ── Real dependencies ────────────────────────────────────────────────────────

const missing = (e: { message: string; code?: string }) => missingTable(e.message, e.code);

async function recentPosts(email: string): Promise<PostRow[]> {
  const { data, error } = await supabase.from('gbp_posts').select(COLS).eq('owner_email', email).order('created_at', { ascending: false }).limit(12);
  if (error) { if (missing(error)) return []; throw new Error(error.message); }
  return (data ?? []) as PostRow[];
}

/** Publishes one row to Google. Shared by the sweep and by the owner's "publish now". */
async function sendToGoogle(email: string, row: PostRow, website: string): Promise<string | null> {
  const access = await accessFor(email);
  if (!access) throw new GbpError('revoked');
  const loc = (await listLocations(access)).find((l) => l.name === row.location_name);
  if (!loc?.account) throw new GbpError('google', 'post:location_not_found');
  return (await createLocalPost(access, loc.account, loc.name, { summary: row.body, cta: row.cta, url: website || null })).name;
}

async function modelWrite(_card: TruthCard, system: string, prompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const r = await new Anthropic({ apiKey }).messages.create({ model: 'claude-sonnet-4-6', max_tokens: 700, system, messages: [{ role: 'user', content: prompt }] });
  return r.content[0]?.type === 'text' ? r.content[0].text : null;
}

const realDeps: SweepDeps = {
  /** Paying accounts with an active Google connection, a chosen location and an approved card. */
  async accounts(now) {
    const { data: prod, error } = await supabase.from('user_products').select('email, status, current_period_end').eq('product', 'seo_autopilot');
    if (error) throw new Error(error.message);
    const paying = ((prod ?? []) as { email: string; status: string; current_period_end: string | null }[]).filter((r) => isEntitled(r, now)).map((r) => r.email);
    if (!paying.length) return [];
    const [{ data: conn }, { data: truth, error: te }] = await Promise.all([
      supabase.from('gbp_connections').select('email').eq('status', 'active').not('location_name', 'is', null).in('email', paying),
      supabase.from('business_truth').select('owner_email').not('approved_at', 'is', null).in('owner_email', paying),
    ]);
    if (te) { if (missing(te)) return []; throw new Error(te.message); }
    const connected = new Set(((conn ?? []) as { email: string }[]).map((r) => r.email));
    return ((truth ?? []) as { owner_email: string }[]).map((r) => r.owner_email).filter((e) => connected.has(e));
  },
  async context(email) {
    const [auto, conn, { data }] = await Promise.all([
      getAutomation(email), getConnection(email),
      supabase.from('business_truth').select('card, location_name, approved_at').eq('owner_email', email).maybeSingle(),
    ]);
    const t = data as { card: TruthCard; location_name: string | null; approved_at: string | null } | null;
    // The card must be approved, the customer must have agreed to automation, and the card must
    // describe the location that is connected NOW (a re-connect to another business resets it).
    if (!t?.approved_at || !auto.consentAt || !conn?.location_name || conn.location_name !== t.location_name) return null;
    return { card: { ...emptyCard(), ...t.card }, location: conn.location_name, mode: auto.postsMode, recent: await recentPosts(email) };
  },
  write: modelWrite,
  async create(row) {
    const { data, error } = await supabase.from('gbp_posts').insert(row).select(COLS).maybeSingle();
    if (error) { if (error.code === '23505') return null; throw new Error(error.message); }
    return (data as PostRow | null) ?? null;
  },
  async due(email, now) {
    const { data, error } = await supabase.from('gbp_posts').select(COLS).eq('owner_email', email).eq('status', 'scheduled').lte('publish_after', now.toISOString()).order('publish_after', { ascending: true }).limit(3);
    if (error) throw new Error(error.message);
    return (data ?? []) as PostRow[];
  },
  async claim(id) {
    const { data, error } = await supabase.from('gbp_posts').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'scheduled').select('id');
    if (error) throw new Error(error.message);
    return (data ?? []).length === 1;
  },
  send: sendToGoogle,
  async finish(id, patch) {
    const { error } = await supabase.from('gbp_posts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  async expire(email, before) {
    const { error } = await supabase.from('gbp_posts').update({ status: 'skipped', last_error: 'not approved in time' })
      .eq('owner_email', email).eq('status', 'scheduled').lt('publish_after', before.toISOString());
    if (error && !missing(error)) throw new Error(error.message);
  },
  log: logActivity,
};

export function startPostsSweep(): void {
  if (!autopilotEnabled()) return;
  const run = () => { withHeartbeat('gbp_posts', sweepPosts).catch((e) => console.error('[POSTS] sweep crashed:', e)); };
  setTimeout(run, 7 * 60 * 1000);
  setInterval(run, SWEEP_EVERY_MS).unref?.();
}

// ── Owner actions (dashboard) ────────────────────────────────────────────────

export class PostError extends Error {
  constructor(public readonly code: 'not_found' | 'bad_text' | 'not_scheduled' | 'not_connected' | 'quota_pending' | 'google' | 'not_migrated', message = code) { super(message); }
}

export interface PostView { id: string; topic: string; body: string; status: PostStatus; edited: boolean; publishAfter: string; publishedAt: string | null; createdAt: string; problem: string | null }
const toView = (r: PostRow): PostView => ({
  id: r.id, topic: r.topic.replace(/^(service|area):/, ''), body: r.body, status: r.status === 'publishing' ? 'scheduled' : r.status, edited: r.edited,
  publishAfter: r.publish_after, publishedAt: r.published_at, createdAt: r.created_at,
  problem: r.last_error === 'google quota pending' ? 'quota_pending' : r.status === 'failed' ? 'failed' : null,
});

export async function listPosts(email: string): Promise<PostView[]> { return (await recentPosts(email)).map(toView); }

async function getOwned(email: string, id: string): Promise<PostRow> {
  const { data, error } = await supabase.from('gbp_posts').select(COLS).eq('id', id).eq('owner_email', email).maybeSingle();
  if (error) { if (missing(error)) throw new PostError('not_migrated'); throw new Error(error.message); }
  if (!data) throw new PostError('not_found');
  return data as PostRow;
}

async function cardOf(email: string): Promise<TruthCard> {
  const { data } = await supabase.from('business_truth').select('card').eq('owner_email', email).maybeSingle();
  return { ...emptyCard(), ...((data as { card?: TruthCard } | null)?.card ?? {}) };
}

/**
 * The owner's own wording. It is theirs, so we do not fact-check it; we only refuse what Google
 * would reject or what cannot be a post (empty, too long, a link in the text).
 */
export function ownerText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return t.length >= 20 && t.length <= 1500 && !/https?:\/\/|www\./i.test(t) ? t : null;
}

export async function editPost(email: string, id: string, raw: unknown): Promise<PostView> {
  const body = ownerText(raw);
  if (!body) throw new PostError('bad_text');
  const p = await getOwned(email, id);
  if (p.status !== 'scheduled') throw new PostError('not_scheduled');
  const { data, error } = await supabase.from('gbp_posts').update({ body, edited: true, updated_at: new Date().toISOString() })
    .eq('id', id).eq('owner_email', email).eq('status', 'scheduled').select(COLS).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new PostError('not_scheduled');
  return toView(data as PostRow);
}

export async function skipPost(email: string, id: string): Promise<void> {
  const p = await getOwned(email, id);
  if (p.status === 'skipped') return;
  if (p.status !== 'scheduled') throw new PostError('not_scheduled');
  const { error } = await supabase.from('gbp_posts').update({ status: 'skipped', updated_at: new Date().toISOString() }).eq('id', id).eq('owner_email', email).eq('status', 'scheduled');
  if (error) throw new Error(error.message);
  await logActivity(email, 'post_skipped', 'עצרתם את הפוסט של השבוע', null, `skipped:${id}`);
}

/** "פרסמו עכשיו": the owner's explicit approval, so no waiting window and no quiet hours. */
export async function publishNow(email: string, id: string, now = new Date()): Promise<PostView> {
  const p = await getOwned(email, id);
  if (p.status === 'published') return toView(p);
  if (p.status !== 'scheduled') throw new PostError('not_scheduled');
  if (!(await realDeps.claim(id))) throw new PostError('not_scheduled');
  try {
    const name = await sendToGoogle(email, p, (await cardOf(email)).website);
    await realDeps.finish(id, { status: 'published', approved: true, published_at: now.toISOString(), google_name: name, last_error: null });
    await logActivity(email, 'post_published', 'פרסמתם פוסט בכרטיס העסק שלכם בגוגל', p.body.slice(0, 160), `published:${id}`);
    return toView({ ...p, status: 'published', published_at: now.toISOString() });
  } catch (e) {
    const quota = e instanceof GbpError && /http_429/.test(e.message);
    // Back to scheduled and marked approved: the sweep publishes it as soon as Google lets us.
    await realDeps.finish(id, { status: 'scheduled', approved: true, last_error: quota ? 'google quota pending' : (e instanceof Error ? e.message.slice(0, 200) : 'unknown') }).catch(() => undefined);
    if (e instanceof GbpError && e.code === 'revoked') { await markNeedsReconnect(email, 'revoked').catch(() => undefined); throw new PostError('not_connected'); }
    if (quota) throw new PostError('quota_pending');
    console.error('[POSTS] publish now failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    throw new PostError('google');
  }
}
