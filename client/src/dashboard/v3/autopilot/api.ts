// The calls of the automatic product. Two implementations of one interface: the server (authFetch,
// the same helper every dashboard call uses) and the preview's in-memory sample.
import { authFetch } from '../../../lib/api';
import { GENERIC_ERROR } from '../autopilotCopy';
import { buildSample, sampleVariant } from './sample';
import type { Activity, Automation, AutomationPatch, GbpStatus, Post, Truth, TruthPatch } from './types';

/** `message` is the server's own Hebrew sentence when it sent one. */
export class ApiError extends Error {
  readonly code: string | null;
  constructor(message: string, code: string | null = null) { super(message); this.code = code; }
}

export interface AutopilotApi {
  truth(): Promise<{ truth: Truth | null; notReady: boolean }>;
  gbp(): Promise<GbpStatus>;
  sync(): Promise<Truth>;
  save(patch: TruthPatch): Promise<Truth>;
  approve(): Promise<Truth>;
  automation(): Promise<Automation>;
  setAutomation(patch: AutomationPatch): Promise<Automation>;
  posts(): Promise<Post[]>;
  editPost(id: string, text: string): Promise<void>;
  publishPost(id: string): Promise<void>;
  skipPost(id: string): Promise<void>;
  activity(): Promise<Activity[]>;
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await authFetch(url, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new ApiError(GENERIC_ERROR); }
  const b = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok || !b) throw new ApiError(typeof b?.error === 'string' && b.error ? b.error : GENERIC_ERROR, typeof b?.code === 'string' ? b.code : null);
  return b as T;
}

const postUrl = (id: string, tail = '') => `/api/seo/posts/${encodeURIComponent(id)}${tail}`;

export const serverApi: AutopilotApi = {
  truth: async () => { const b = await call<{ truth: Truth | null; notReady?: boolean }>('/api/seo/truth'); return { truth: b.truth ?? null, notReady: b.notReady === true }; },
  gbp: async () => {
    try { const b = await call<Partial<GbpStatus>>('/api/seo/gbp/status'); return { enabled: b.enabled === true, connected: b.connected === true, needsReconnect: b.needsReconnect === true }; }
    catch { return { enabled: false, connected: false, needsReconnect: false }; }
  },
  sync: async () => (await call<{ truth: Truth }>('/api/seo/truth/sync', 'POST')).truth,
  save: async (patch) => (await call<{ truth: Truth }>('/api/seo/truth', 'PUT', patch)).truth,
  approve: async () => (await call<{ truth: Truth }>('/api/seo/truth/approve', 'POST')).truth,
  automation: () => call<Automation>('/api/seo/automation'),
  setAutomation: (patch) => call<Automation>('/api/seo/automation', 'PUT', patch),
  posts: async () => (await call<{ posts?: Post[] }>('/api/seo/posts')).posts ?? [],
  editPost: async (id, text) => { await call(postUrl(id), 'PUT', { text }); },
  publishPost: async (id) => { await call(postUrl(id, '/publish'), 'POST'); },
  skipPost: async (id) => { await call(postUrl(id, '/skip'), 'POST'); },
  activity: async () => (await call<{ items?: Activity[] }>('/api/seo/activity')).items ?? [],
};

/** Preview: the same calls over a sample kept in memory. Nothing leaves the browser. */
export function sampleApi(): AutopilotApi {
  const s = buildSample(sampleVariant());
  const now = () => new Date().toISOString();
  const log = (kind: Activity['kind'], title: string) => { s.activity = [{ id: `p${s.activity.length}`, kind, title, detail: null, createdAt: now() }, ...s.activity]; };
  const find = (id: string): Post => {
    const p = s.posts.find((x) => x.id === id);
    if (!p || p.status !== 'scheduled') throw new ApiError('הפוסט הזה כבר פורסם או נעצר.', 'not_scheduled');
    return p;
  };
  const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    truth: async () => ({ truth: copy(s.truth), notReady: false }),
    gbp: async () => s.gbp,
    sync: async () => { s.truth.fetchedAt = now(); return copy(s.truth); },
    save: async (patch) => {
      const { services, ...rest } = patch;
      Object.assign(s.truth.card, rest);
      if (services) s.truth.card.services = services.map((x) => ({ ...x, source: 'customer' as const }));
      return copy(s.truth);
    },
    approve: async () => {
      s.truth.approvedAt = now(); s.automation.consentAt = now();
      log('card_approved', 'אישרתם את פרטי העסק, ואנחנו מתחילים לעבוד');
      return copy(s.truth);
    },
    automation: async () => copy(s.automation),
    setAutomation: async (patch) => { Object.assign(s.automation, patch); return copy(s.automation); },
    posts: async () => copy(s.posts),
    editPost: async (id, text) => {
      if (text.trim().length < 20) throw new ApiError('הטקסט קצר מדי, ארוך מדי או כולל קישור.', 'bad_text');
      const p = find(id); p.body = text.trim(); p.edited = true;
    },
    publishPost: async (id) => { const p = find(id); p.status = 'published'; p.publishedAt = now(); log('post_published', `פרסמנו פוסט בכרטיס העסק שלכם בגוגל: ${p.topic}`); },
    skipPost: async (id) => { const p = find(id); p.status = 'skipped'; log('post_skipped', `דילגנו על הפוסט של השבוע: ${p.topic}`); },
    activity: async () => copy(s.activity),
  };
}
