// The calls of the automatic product. Two implementations of one interface: the server (authFetch,
// the same helper every dashboard call uses) and the preview's in-memory sample.
import { authFetch } from '../../../lib/api';
import { shareUrl } from '../../../lib/pageUrl';
import { GENERIC_ERROR } from '../autopilotCopy';
import { buildSample, sampleFlag, sampleLanding, sampleVariant } from './sample';
import type { GoogleNumbers, PhrasePage, Phrases } from './types';
import type { Activity, Automation, AutomationPatch, GbpStatus, LandingResult, Post, PublishResult, Truth, TruthPatch } from './types';

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
  /** Can take about a minute: the page is written on the server before it answers. */
  createLanding(): Promise<LandingResult>;
  phrases(): Promise<Phrases>;
  /** About half a minute: the page is written before the server answers. */
  createPhrase(phrase: string): Promise<{ page: PhrasePage; parentPublished: boolean }>;
  /** Does the subscription cover publishing this draft? (GET /api/landing/:id/included) */
  included(id: string): Promise<boolean>;
  /** Publishes the included page. 402 comes back as `needsPayment` with the server's sentence; nothing is charged here. */
  publishLanding(id: string): Promise<PublishResult>;
  /** Where the customer connects the Google account that manages the listing (the same call GbpCard makes). */
  connectUrl(): Promise<string>;
  /** Never throws: null means "no numbers from Google right now". */
  googleNumbers(): Promise<GoogleNumbers | null>;
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

/** a server sentence is shown only when it is written for the customer */
const HEBREW = /[\u0590-\u05FF]/;
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
  createLanding: async () => {
    // 201 = the created page itself; 200 = { existing: true, id, slug, status } for an account that already has one.
    const b = await call<Record<string, unknown>>('/api/seo/truth/landing', 'POST');
    if (typeof b.slug !== 'string' || !b.slug) throw new ApiError(GENERIC_ERROR);
    const existing = b.existing === true;
    return { existing, id: String(b.id ?? ''), slug: b.slug, status: existing && typeof b.status === 'string' ? b.status : 'draft' };
  },
  phrases: async () => {
    const b = await call<Partial<Phrases>>('/api/seo/truth/phrases');
    return { hasPage: b.hasPage === true, parentPublished: b.parentPublished === true, pages: b.pages ?? [], ideas: b.ideas ?? [], cap: Number(b.cap) || 0, left: Number(b.left) || 0 };
  },
  createPhrase: async (phrase) => {
    const b = await call<{ page?: PhrasePage; parentPublished?: boolean }>('/api/seo/truth/phrases', 'POST', { phrase });
    if (!b.page) throw new ApiError(GENERIC_ERROR);
    return { page: b.page, parentPublished: b.parentPublished === true };
  },
  included: async (id) => (await call<{ included?: boolean }>(`/api/landing/${encodeURIComponent(id)}/included`)).included === true,
  publishLanding: async (id) => {
    let r: Response;
    try { r = await authFetch(`/api/landing/${encodeURIComponent(id)}/publish`, { method: 'POST' }); } catch { throw new ApiError(GENERIC_ERROR); }
    const b = (await r.json().catch(() => null)) as Record<string, unknown> | null;
    const said = typeof b?.error === 'string' && HEBREW.test(b.error) ? b.error : null;
    if (r.status === 402) return { ok: false, needsPayment: true, error: said ?? GENERIC_ERROR };
    if (!r.ok || !b || typeof b.slug !== 'string' || !b.slug) throw new ApiError(said ?? GENERIC_ERROR);
    return { ok: true, slug: b.slug, url: shareUrl(b.slug, typeof b.subdomain === 'string' ? b.subdomain : null) };
  },
  connectUrl: async () => {
    const b = await call<{ url?: string }>('/api/seo/gbp/oauth/start');
    if (!b.url) throw new ApiError(GENERIC_ERROR);
    return b.url;
  },
  googleNumbers: async () => {
    try {
      const b = await call<{ totals?: Partial<GoogleNumbers> }>('/api/seo/gbp/stats');
      return b.totals ? { calls: Number(b.totals.calls) || 0, directions: Number(b.totals.directions) || 0 } : null;
    } catch { return null; }
  },
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
    truth: async () => ({ truth: s.read ? copy(s.truth) : null, notReady: false }),
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
    createLanding: async () => {
      const mode = sampleLanding();
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      if (mode === 'error') { await wait(1500); throw new ApiError('אי אפשר ליצור דף עדיין. חסרים פרטי חובה בפרטי העסק.', 'not_ready'); }
      if (mode === 'existing') { await wait(600); return { existing: true, id: 'sample-page', slug: 'sample-page', status: 'published' }; }
      if (s.page) { await wait(600); return { ...s.page, existing: true }; }
      await wait(6000);   // the real call takes about a minute; long enough here to see the waiting state
      s.page = { existing: false, id: 'sample-page', slug: 'sample-page', status: 'draft' };
      s.phrases.hasPage = true;
      log('page_created', 'יצרנו לכם דף נחיתה מפרטי העסק');
      return { ...s.page };
    },
    phrases: async () => copy(s.phrases),
    createPhrase: async (phrase) => {
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const idea = s.phrases.ideas.find((i) => i.phrase === phrase);
      if (!s.phrases.hasPage) throw new ApiError('צריך קודם דף נחיתה. צרו אותו בלחיצה אחת מפרטי העסק.', 'no_page');
      if (!idea) throw new ApiError('אפשר ליצור דף רק לשירות ולאזור שמופיעים בפרטי העסק שלכם.', 'not_offered');
      if (s.phrases.left <= 0) throw new ApiError('הגעתם למספר הדפים שמתאים לעסק שלכם. הוספת שירותים או אזורים בפרטי העסק פותחת דפים נוספים.', 'limit');
      await wait(5000);   // the real call takes about half a minute
      const page: PhrasePage = { id: `sample-phrase-${s.phrases.pages.length}`, phrase, title: phrase, url: '' };
      s.phrases.pages = [...s.phrases.pages, page];
      s.phrases.ideas = s.phrases.ideas.filter((i) => i.phrase !== phrase);
      s.phrases.left -= 1;
      log('page_created', `יצרנו דף לחיפוש "${phrase}"`);
      return { page, parentPublished: s.phrases.parentPublished };
    },
    included: async () => { await new Promise((r) => setTimeout(r, 300)); return sampleFlag('included') !== 'no'; },
    publishLanding: async () => {
      await new Promise((r) => setTimeout(r, 1500));
      if (sampleFlag('publish') === '402') return { ok: false, needsPayment: true, error: 'אין לך יתרת דפים לפרסום. אפשר לשלם על הדף הזה בנפרד, או לרכוש חבילת דפים ולחסוך.' };
      if (s.page) s.page.status = 'published';
      s.phrases.parentPublished = true;
      return { ok: true, slug: 'sample-page', url: 'https://pagey.co.il/p/sample-page' };
    },
    connectUrl: async () => { throw new ApiError('בתצוגה לדוגמה אין חיבור אמיתי לגוגל.'); },
    googleNumbers: async () => (s.truth.approvedAt ? { calls: 9, directions: 7 } : null),
  };
}
