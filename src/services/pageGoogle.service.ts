// The business's landing page and its Google listing, shared both ways (README part 143; migration 055).
// The pure rules are in pageGoogle.ts. This file reads and writes: the page's link to the connected listing,
// the reviews cache, the photos sent each way.
//
// A page is LINKED when it is the business's own page (businessPageId) of an account whose Google listing is
// connected and whose business card describes that listing. Only a linked page shows Google reviews and the
// card's practical details, and only its photos go to Google. Every write to Google stays behind
// GBP_WRITEBACK_ENABLED (addPhoto refuses with 'sync_off').
//
// Google policy notes:
//   - Reviews come from the Business Profile API for the owner's OWN listing (OAuth). The owner may show them
//     on their own site; we keep only what the page shows (rating, count, 3-4 reviews with first names), for
//     24 hours before reading again, and stop showing it once the connection is gone.
//   - Places API reviews are NOT used here: Places content may not be cached, so the page would need a paid
//     live call per visitor and Places' own display rules (that is what the external widget does).

import { createHash } from 'crypto';
import { supabase } from '../config/supabase';
import { type TruthCard, emptyCard } from './businessTruth';
import { readState } from './gbpSync';
import { writeBackEnabled } from './businessTruth.service';
import { GbpError, listLocations, listReviewsWithSummary, type GbpPhoto, type GbpReview } from './gbpGoogle';
import { getConnection, markNeedsReconnect } from './gbpStore';
import { accessFor } from './reviewAlerts.service';
import { type PhotosMode, getAutomation, logActivity, missingTable } from './automation.service';
import { businessPageId } from './seoPageAddon.service';
import { shareUrl } from './subdomain.service';
import { SyncError, addPhoto, listPhotos } from './gbpSync.service';
import { PhotoInputError, allowedImageHost, fetchPageImage, storeGooglePhoto, toGooglePhoto } from './gbpPhotos';
import { type AiStore, type ImageStore, type ImgMeta, MAX_GALLERY_IMAGES, applyImageSlot, galleryOf } from './imageSlots';
import {
  type PageFacts, type PageReviews, type SentPhoto, REVIEWS_MIN_COUNT, REVIEWS_MIN_RATING, REVIEWS_SECTION_ID, SEND_GAP_MS,
  alreadySent, buildPageReviews, googlePhotoHost, newPagePhotos, pageFacts, photoAction, readSent, reviewsForViewer, reviewsFresh, reviewsShowable, withSent,
} from './pageGoogle';
import type { AttributeMeta } from './gbpAttributes';

// ── Storage ──────────────────────────────────────────────────────────────────

export interface SyncRow { location_name: string | null; account_name: string | null; reviews: PageReviews | null; reviews_fetched_at: string | null; sent_photos: SentPhoto[] }
const COLS = 'location_name, account_name, reviews, reviews_fetched_at, sent_photos';
const noTable = (e: { message?: string; code?: string }) => missingTable(e.message, e.code) || (/gbp_page_sync/.test(e.message ?? '') && /does not exist|schema cache/.test(e.message ?? ''));

/** The account's row; null = no row yet; 'missing' = migration 055 has not run. */
export async function readSyncRow(email: string): Promise<SyncRow | null | 'missing'> {
  const { data, error } = await supabase.from('gbp_page_sync').select(COLS).eq('owner_email', email).maybeSingle();
  if (error) { if (noTable(error)) return 'missing'; throw new Error(error.message); }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    location_name: typeof r.location_name === 'string' ? r.location_name : null,
    account_name: typeof r.account_name === 'string' ? r.account_name : null,
    reviews: r.reviews && typeof r.reviews === 'object' ? (r.reviews as PageReviews) : null,
    reviews_fetched_at: typeof r.reviews_fetched_at === 'string' ? r.reviews_fetched_at : null,
    sent_photos: readSent(r.sent_photos),
  };
}

/** Upsert; false when the table does not exist yet. */
export async function saveSyncRow(email: string, patch: Partial<SyncRow>): Promise<boolean> {
  const { error } = await supabase.from('gbp_page_sync').upsert({ owner_email: email, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'owner_email' });
  if (error) { if (noTable(error)) return false; throw new Error(error.message); }
  return true;
}

// ── Which page is linked ─────────────────────────────────────────────────────

export interface PageRef { id: string; owner_email?: string | null; parent_id?: string | null }
export interface PageLink { email: string; location: string }

export interface LinkDeps {
  businessPageId(email: string): Promise<string | null>;
  connectedLocation(email: string): Promise<string | null>;
  truth(email: string): Promise<{ card: TruthCard; location: string | null; meta: AttributeMeta[] } | null>;
}

export const realLinkDeps: LinkDeps = {
  businessPageId,
  async connectedLocation(email) {
    try { const c = await getConnection(email); return c?.status === 'active' ? c.location_name ?? null : null; } catch { return null; }
  },
  async truth(email) {
    const { data, error } = await supabase.from('business_truth').select('card, location_name, google_state').eq('owner_email', email).maybeSingle();
    if (error || !data) return null;
    const r = data as { card: TruthCard | null; location_name: string | null; google_state?: unknown };
    return { card: { ...emptyCard(), ...(r.card ?? {}) }, location: r.location_name, meta: readState(r.google_state).attributeMeta?.items ?? [] };
  },
};

/** The page is the business's own page, the listing is connected, and the business card describes that listing. */
export async function linkOf(page: PageRef, deps: LinkDeps = realLinkDeps): Promise<(PageLink & { card: TruthCard; meta: AttributeMeta[] }) | null> {
  const email = (page.owner_email ?? '').trim().toLowerCase();
  if (!email || page.parent_id) return null;
  if ((await deps.businessPageId(email)) !== page.id) return null;
  const location = await deps.connectedLocation(email);
  if (!location) return null;
  const t = await deps.truth(email);
  if (!t || t.location !== location) return null;
  return { email, location, card: t.card, meta: t.meta };
}

// ── Reviews ──────────────────────────────────────────────────────────────────

export interface ReviewDeps {
  access(email: string): Promise<string | null>;
  account(access: string, location: string): Promise<string | null>;
  reviews(access: string, account: string, location: string): Promise<{ reviews: GbpReview[]; summary: { average: number; total: number } | null }>;
  row(email: string): Promise<SyncRow | null | 'missing'>;
  save(email: string, patch: Partial<SyncRow>): Promise<boolean>;
  revoked(email: string): Promise<void>;
}

export const realReviewDeps: ReviewDeps = {
  access: accessFor,
  async account(access, location) { return (await listLocations(access)).find((l) => l.name === location)?.account ?? null; },
  reviews: (a, acc, l) => listReviewsWithSummary(a, acc, l),
  row: readSyncRow,
  save: saveSyncRow,
  revoked: async (email) => { await markNeedsReconnect(email, 'revoked').catch(() => undefined); },
};

const inflight = new Set<string>();
const backoffUntil = new Map<string, number>();
const BACKOFF_MS = 3_600_000;

/**
 * Reads the listing's reviews again and stores what the page shows (null under the threshold). One refresh
 * per account at a time; after a failure, none for an hour. Never throws.
 */
export async function refreshReviews(email: string, location: string, mapsUrl: string | null, now = new Date(), deps: ReviewDeps = realReviewDeps): Promise<'saved' | 'busy' | 'backoff' | 'not_connected' | 'missing' | 'failed'> {
  if (inflight.has(email)) return 'busy';
  if ((backoffUntil.get(email) ?? 0) > now.getTime()) return 'backoff';
  inflight.add(email);
  try {
    const row = await deps.row(email);
    if (row === 'missing') return 'missing';
    const access = await deps.access(email);
    if (!access) return 'not_connected';
    const account = (row?.location_name === location && row.account_name) || (await deps.account(access, location));
    if (!account) return 'not_connected';
    const r = await deps.reviews(access, account, location);
    await deps.save(email, { location_name: location, account_name: account, reviews: buildPageReviews(r.reviews, r.summary, mapsUrl, now), reviews_fetched_at: now.toISOString() });
    return 'saved';
  } catch (e) {
    if (e instanceof GbpError && e.code === 'revoked') { await deps.revoked(email); return 'not_connected'; }
    backoffUntil.set(email, now.getTime() + BACKOFF_MS);
    console.error('[PAGE-GOOGLE] reviews refresh failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    return 'failed';
  } finally { inflight.delete(email); }
}

// ── What the page gets (GET /api/landing/:slug) ──────────────────────────────

export interface PageGoogleBlock {
  /** Owner only: the page is linked (the editor offers "תמונות מהכרטיס בגוגל"). */
  linked?: boolean;
  facts: PageFacts | null;
  reviews: PageReviews | null;
}

const CACHE_MS = 5 * 60_000;
const blockCache = new Map<string, { at: number; link: boolean; facts: PageFacts | null; reviews: PageReviews | null }>();
export const forgetPageGoogle = (pageId: string): void => { blockCache.delete(pageId); };

export interface BlockDeps { link: LinkDeps; reviews: ReviewDeps; now(): Date }
const realBlockDeps: BlockDeps = { link: realLinkDeps, reviews: realReviewDeps, now: () => new Date() };

/**
 * The Google part of a page: the business card's practical details and the reviews. Held 5 minutes in memory
 * per page (a busy page does not read four tables per view). Stale reviews are refreshed in the background:
 * the visitor never waits for Google. Never throws: a page always renders, with or without this.
 */
export async function googleBlockForPage(page: PageRef & { ai_content?: unknown }, isOwner: boolean, deps: BlockDeps = realBlockDeps): Promise<PageGoogleBlock | null> {
  try {
    const now = deps.now();
    let c = blockCache.get(page.id);
    if (!c || now.getTime() - c.at > CACHE_MS) {
      const link = await linkOf(page, deps.link);
      let reviews: PageReviews | null = null;
      if (link) {
        const row = await deps.reviews.row(link.email);
        const ok = row && row !== 'missing' && row.location_name === link.location;
        if (ok && reviewsShowable(row.reviews_fetched_at, now)) reviews = row.reviews;
        if (row !== 'missing' && !(ok && reviewsFresh(row.reviews_fetched_at, now))) {
          void refreshReviews(link.email, link.location, link.card.mapsUrl || null, now, deps.reviews).then((r) => { if (r === 'saved') blockCache.delete(page.id); });
        }
      }
      c = { at: now.getTime(), link: !!link, facts: link ? pageFacts(link.card, link.meta) : null, reviews };
      blockCache.set(page.id, c);
      if (blockCache.size > 2000) blockCache.delete(blockCache.keys().next().value as string);
    }
    if (!c.link) return isOwner ? { linked: false, facts: null, reviews: null } : null;
    const hidden = (page.ai_content as { hidden_sections?: unknown } | null)?.hidden_sections;
    return { ...(isOwner ? { linked: true } : {}), facts: c.facts, reviews: reviewsForViewer(c.reviews, hidden, isOwner) };
  } catch (e) {
    console.error('[PAGE-GOOGLE] block failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    return null;
  }
}

// ── Page photos -> the listing ───────────────────────────────────────────────

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export interface SendDeps {
  row(email: string): Promise<SyncRow | null | 'missing'>;
  save(email: string, patch: Partial<SyncRow>): Promise<boolean>;
  fetchImage(email: string, url: string): Promise<{ buffer: Buffer; mime: string }>;
  /** Converts (WebP -> JPEG), stores publicly and adds to the listing; returns Google's media id. */
  addToListing(email: string, buffer: Buffer, mime: string): Promise<string | null>;
}

export const realSendDeps: SendDeps = {
  row: readSyncRow,
  save: saveSyncRow,
  fetchImage: (email, url) => fetchPageImage(email, url),
  async addToListing(email, buffer, mime) {
    const jpeg = await toGooglePhoto(buffer, mime);
    return (await addPhoto(email, 'ADDITIONAL', () => storeGooglePhoto(email, jpeg.buffer))).id;
  },
};

/**
 * Sends one page photo to the listing, at most once ever: the URL and the bytes' hash are recorded BEFORE the
 * call to Google (a crash between the two can never cause a second send), and the record is dropped again only
 * when Google did not take it for a reason that may pass (quota, Google down, sync off, not connected).
 */
export async function sendPagePhoto(email: string, url: string, origin: 'page' | 'manual' = 'page', deps: SendDeps = realSendDeps, now = new Date()): Promise<'sent' | 'duplicate' | 'missing' | 'skipped' | 'failed'> {
  const row = await deps.row(email);
  if (row === 'missing') return 'missing';
  const sent = row?.sent_photos ?? [];
  if (alreadySent(sent, url)) return 'duplicate';
  let src: { buffer: Buffer; mime: string };
  try { src = await deps.fetchImage(email, url); } catch { return 'skipped'; }
  const h = sha256(src.buffer);
  if (alreadySent(sent, url, h)) {
    await deps.save(email, { sent_photos: withSent(sent, { u: url, h, m: null, o: origin, at: now.toISOString() }) });
    return 'duplicate';
  }
  const reserved = withSent(sent, { u: url, h, m: null, o: origin, at: now.toISOString() });
  if (!(await deps.save(email, { sent_photos: reserved }))) return 'missing';
  try {
    const id = await deps.addToListing(email, src.buffer, src.mime);
    await deps.save(email, { sent_photos: withSent(reserved, { u: url, h, m: id, o: origin, at: now.toISOString() }) });
    return 'sent';
  } catch (e) {
    if (e instanceof PhotoInputError) return 'skipped';   // too small or unreadable: stays recorded, never retried
    // may pass: free the record so the photo can be sent later
    const fresh = await deps.row(email);
    if (fresh && fresh !== 'missing') await deps.save(email, { sent_photos: fresh.sent_photos.filter((s) => !(s.u === url && !s.m)) });
    console.error('[PAGE-GOOGLE] photo to listing failed:', e instanceof SyncError ? e.code : e instanceof Error ? e.message.slice(0, 120) : 'unknown');
    return 'failed';
  }
}

/**
 * One queue per account: photos go to Google one after another, SEND_GAP_MS apart (Google allows 10 edits a
 * minute per listing). A URL already waiting is not queued twice. `send` and `sleep` are replaceable for tests.
 */
export function createPhotoQueue(send: (email: string, url: string) => Promise<unknown>, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const chains = new Map<string, Promise<void>>();
  const waiting = new Map<string, Set<string>>();
  return {
    add(email: string, urls: string[]): number {
      const w = waiting.get(email) ?? new Set<string>();
      waiting.set(email, w);
      const fresh = urls.filter((u) => !w.has(u));
      for (const u of fresh) w.add(u);
      let chain = chains.get(email) ?? Promise.resolve();
      for (const u of fresh) {
        chain = chain.then(async () => {
          try { await send(email, u); } catch { /* one photo never stops the others */ }
          w.delete(u);
          await sleep(SEND_GAP_MS);
        });
      }
      chains.set(email, chain.finally(() => { if (chains.get(email) === chain) { chains.delete(email); waiting.delete(email); } }));
      return fresh.length;
    },
    idle(email: string): Promise<void> { return chains.get(email) ?? Promise.resolve(); },
  };
}

const queue = createPhotoQueue((email, url) => sendPagePhoto(email, url));

interface PageRow extends PageRef { user_images: string | null; logo_url: string | null; slug: string; subdomain: string | null; status: string; business_name: string | null; image_source: string | null; ai_content?: unknown }
const PAGE_COLS = 'id, owner_email, parent_id, user_images, logo_url, slug, subdomain, status, business_name, image_source, ai_content';

async function loadPage(id: string): Promise<PageRow | null> {
  const { data } = await supabase.from('landing_pages').select(PAGE_COLS).eq('id', id).maybeSingle();
  return (data as PageRow | null) ?? null;
}
const parseStore = (s: string | null): ImageStore | null => { try { return JSON.parse(s ?? 'null') as ImageStore; } catch { return null; } };

/**
 * After the owner added photos to the page (editor upload): with the setting "auto" and the sync to Google on,
 * the NEW photos go to the listing (in the background, paced). Only the photos of this upload: what was on the
 * page before is offered in the dashboard instead, so nothing old is pushed by surprise. Never throws.
 */
export async function onPagePhotosAdded(pageId: string, urls: string[]): Promise<'none' | 'suggest' | number> {
  try {
    const page = await loadPage(pageId);
    if (!page) return 'none';
    const link = await linkOf(page);
    if (!link) return 'none';
    const row = await readSyncRow(link.email);
    const action = photoAction({ mode: (await getAutomation(link.email)).photosMode, writeEnabled: writeBackEnabled(), linked: true, migrated: row !== 'missing' });
    if (action !== 'send') return action;
    const fresh = new Set(urls);
    const list = newPagePhotos(parseStore(page.user_images), page.logo_url, row === 'missing' ? [] : row?.sent_photos ?? [], allowedImageHost).filter((p) => fresh.has(p.url));
    return queue.add(link.email, list.map((p) => p.url));
  } catch (e) {
    console.error('[PAGE-GOOGLE] photos hook failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    return 'none';
  }
}

/** The dashboard sent a page photo by hand ("מדף הנחיתה"): remembered, so it is never sent again by itself. */
export async function recordManualSend(email: string, url: string, mediaId: string | null): Promise<void> {
  try {
    const row = await readSyncRow(email);
    if (row === 'missing') return;
    await saveSyncRow(email, { sent_photos: withSent(row?.sent_photos ?? [], { u: url, m: mediaId, o: 'manual', at: new Date().toISOString() }) });
  } catch { /* best effort */ }
}

// ── The dashboard block "מחובר לדף שלכם" ─────────────────────────────────────

export type ReviewsState = 'shown' | 'hidden' | 'below' | 'waiting' | 'not_active';
export interface PageLinkView {
  linked: boolean;
  /** false = migration 055 has not run: reviews and automatic photos are not active yet */
  ready: boolean;
  syncEnabled: boolean;
  page: { id: string; url: string; status: string } | null;
  websiteMode: 'auto' | 'ask' | 'off';
  photosMode: PhotosMode;
  website: { onListing: boolean };
  photos: { sent: number; fromGoogle: number; pending: Array<{ url: string; thumb: string }> };
  reviews: { state: ReviewsState; rating: number | null; count: number | null; minCount: number; minRating: number };
}

export async function pageLinkView(email: string): Promise<PageLinkView> {
  const owner = email.trim().toLowerCase();
  const auto = await getAutomation(owner);
  const pageId = await businessPageId(owner);
  const page = pageId ? await loadPage(pageId) : null;
  const link = page ? await linkOf(page) : null;
  const row = await readSyncRow(owner).catch(() => null);
  const ready = row !== 'missing';
  const r = row && row !== 'missing' ? row : null;
  const url = page ? shareUrl(page.slug, page.subdomain) : '';
  const store = page ? parseStore(page.user_images) : null;
  const meta = store && !Array.isArray(store) ? (store as AiStore).img_meta ?? {} : {};
  const pending = link && page ? newPagePhotos(store, page.logo_url, r?.sent_photos ?? [], allowedImageHost).slice(0, 12) : [];
  // hidden by the owner: the reviews switch itself, or the whole reviews section of the page
  const hiddenList = (page?.ai_content as { hidden_sections?: unknown } | null)?.hidden_sections;
  const hidden = Array.isArray(hiddenList) && (hiddenList.includes(REVIEWS_SECTION_ID) || hiddenList.includes('testimonials_grid'));
  const fresh = r && link && r.location_name === link.location ? r : null;
  const state: ReviewsState = !ready || !link ? 'not_active'
    : !fresh?.reviews_fetched_at ? 'waiting'
    : !fresh.reviews ? 'below'
    : hidden ? 'hidden' : 'shown';
  if (link && ready && (!fresh || !reviewsFresh(fresh.reviews_fetched_at, new Date()))) void refreshReviews(owner, link.location, link.card.mapsUrl || null);
  const same = (a: string, b: string) => !!a && !!b && a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();
  return {
    linked: !!link, ready, syncEnabled: writeBackEnabled(),
    page: page ? { id: page.id, url, status: page.status } : null,
    websiteMode: auto.websiteMode, photosMode: auto.photosMode,
    website: { onListing: !!link && same(link.card.website, url) },
    photos: {
      sent: (r?.sent_photos ?? []).filter((s) => s.o !== 'google' && s.m).length,
      fromGoogle: (r?.sent_photos ?? []).filter((s) => s.o === 'google').length,
      pending: pending.map((p) => ({ url: p.url, thumb: (meta[p.url] as ImgMeta | undefined)?.sm || p.url })),
    },
    reviews: { state, rating: fresh?.reviews?.rating ?? null, count: fresh?.reviews?.count ?? null, minCount: REVIEWS_MIN_COUNT, minRating: REVIEWS_MIN_RATING },
  };
}

/** "Add to Google" in the dashboard: the chosen photos waiting there (all of them when none are named). */
export async function sendPendingPhotos(email: string, urls: string[] | null): Promise<number> {
  const owner = email.trim().toLowerCase();
  if (!writeBackEnabled()) throw new SyncError('sync_off');
  const pageId = await businessPageId(owner);
  const page = pageId ? await loadPage(pageId) : null;
  const link = page ? await linkOf(page) : null;
  if (!page || !link) throw new SyncError('not_connected');
  const row = await readSyncRow(owner);
  if (row === 'missing') throw new SyncError('not_migrated');
  const list = newPagePhotos(parseStore(page.user_images), page.logo_url, row?.sent_photos ?? [], allowedImageHost).map((p) => p.url);
  const chosen = urls ? list.filter((u) => urls.includes(u)) : list;
  return queue.add(owner, chosen);
}

// ── Listing photos -> the page (the editor, one click) ───────────────────────

export class PageGoogleError extends Error {
  constructor(public readonly code: 'not_linked' | 'full' | 'none' | 'google') { super(code); }
}

export interface ImportDeps {
  listPhotos(email: string): Promise<GbpPhoto[]>;
  fetchPhoto(url: string): Promise<Buffer>;
  process(buffer: Buffer, businessName: string): Promise<{ url: string; meta: ImgMeta; warning: { message: string } | null }>;
  savePage(id: string, userImages: string): Promise<void>;
  row(email: string): Promise<SyncRow | null | 'missing'>;
  saveRow(email: string, patch: Partial<SyncRow>): Promise<boolean>;
  log: typeof logActivity;
}

/** Google's photo, no redirects to anywhere else, 15 s, 15 MB. */
export async function fetchGooglePhoto(url: string, f: typeof fetch = fetch): Promise<Buffer> {
  if (!googlePhotoHost(url)) throw new PageGoogleError('google');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    let r = await f(url, { redirect: 'manual', signal: ctrl.signal });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc && googlePhotoHost(new URL(loc, url).toString())) r = await f(new URL(loc, url).toString(), { redirect: 'error', signal: ctrl.signal });
    if (!r.ok || !/^image\//.test(r.headers.get('content-type') ?? '')) throw new PageGoogleError('google');
    const b = Buffer.from(await r.arrayBuffer());
    if (!b.length || b.length > 15 * 1024 * 1024) throw new PageGoogleError('google');
    return b;
  } finally { clearTimeout(timer); }
}

export const realImportDeps: ImportDeps = {
  listPhotos: (email) => listPhotos(email),
  fetchPhoto: (url) => fetchGooglePhoto(url),
  async process(buffer, businessName) {
    const { processPhoto } = await import('./landingImages');
    const p = await processPhoto(buffer, { role: 'photo', businessName, prefix: 'google' });
    return { url: p.url, meta: p.meta, warning: p.warning };
  },
  async savePage(id, userImages) {
    const { error } = await supabase.from('landing_pages').update({ user_images: userImages }).eq('id', id);
    if (error) throw new Error(error.message);
  },
  row: readSyncRow, saveRow: saveSyncRow, log: logActivity,
};

/** Google media ids already on the page (taken from the listing before). */
export function googleIdsOnPage(store: ImageStore | null): Set<string> {
  if (!store || Array.isArray(store)) return new Set();
  return new Set(Object.values(store.img_meta ?? {}).map((m) => m?.gid).filter((x): x is string => !!x));
}

const freeGallerySlots = (store: ImageStore | null): number[] => {
  const g = galleryOf(store);
  const out: number[] = [];
  for (let i = 0; i < MAX_GALLERY_IMAGES; i++) if (!g[i]) out.push(i);
  return out;
};

/** The editor's picker: the listing's photos, each marked when it is already on the page. */
export async function googlePhotosForPage(pageId: string, deps: Pick<ImportDeps, 'listPhotos'> = realImportDeps): Promise<{ linked: boolean; photos: Array<{ id: string; thumbUrl: string; category: string; onPage: boolean }>; free: number }> {
  const page = await loadPage(pageId);
  const link = page ? await linkOf(page) : null;
  if (!page || !link) return { linked: false, photos: [], free: 0 };
  const store = parseStore(page.user_images);
  const on = googleIdsOnPage(store);
  const list = (await deps.listPhotos(link.email)).filter((p) => p.state === 'live' && googlePhotoHost(p.url));
  return { linked: true, photos: list.map((p) => ({ id: p.id, thumbUrl: googlePhotoHost(p.thumbUrl) ? p.thumbUrl : p.url, category: p.category, onPage: on.has(p.id) })), free: freeGallerySlots(store).length };
}

/**
 * Adds the listing photos the owner picked to the page gallery: each one is fetched from Google, goes through
 * the page's own pipeline (sizes, focal point, alt text, quality note) and is marked as coming from Google, so it
 * is never sent back. Only ids the listing really has; never more than the free gallery places.
 */
export async function importGooglePhotos(pageId: string, ids: string[], deps: ImportDeps = realImportDeps, loader: (id: string) => Promise<PageRow | null> = loadPage, linker: (p: PageRow) => Promise<PageLink | null> = (p) => linkOf(p)): Promise<{ user_images: string; added: number; warnings: string[] }> {
  const page = await loader(pageId);
  const link = page ? await linker(page) : null;
  if (!page || !link) throw new PageGoogleError('not_linked');
  let store = parseStore(page.user_images);
  const on = googleIdsOnPage(store);
  const wanted = [...new Set(ids)].filter((id) => /^[\w-]{4,200}$/.test(id) && !on.has(id));
  if (!wanted.length) throw new PageGoogleError('none');
  const free = freeGallerySlots(store);
  if (!free.length) throw new PageGoogleError('full');
  let listing: GbpPhoto[];
  try { listing = await deps.listPhotos(link.email); } catch { throw new PageGoogleError('google'); }
  const byId = new Map(listing.filter((p) => p.state === 'live' && googlePhotoHost(p.url)).map((p) => [p.id, p]));
  const promote = page.image_source === 'upload';
  const warnings: string[] = [];
  const added: Array<{ url: string; gid: string }> = [];
  for (const id of wanted) {
    const p = byId.get(id);
    const slot = free[added.length];
    if (!p || slot === undefined) continue;
    try {
      const done = await deps.process(await deps.fetchPhoto(p.url), page.business_name ?? '');
      store = applyImageSlot(store, { kind: 'gallery', index: slot }, done.url, { ...done.meta, from: 'google', gid: id }, promote);
      added.push({ url: done.url, gid: id });
      if (done.warning && !warnings.includes(done.warning.message)) warnings.push(done.warning.message);
    } catch (e) {
      console.error('[PAGE-GOOGLE] import of one photo failed:', e instanceof Error ? e.message.slice(0, 120) : 'unknown');
    }
  }
  if (!added.length) throw new PageGoogleError('google');
  const serialized = JSON.stringify(store);
  await deps.savePage(page.id, serialized);
  forgetPageGoogle(page.id);
  const row = await deps.row(link.email).catch(() => 'missing' as const);
  if (row !== 'missing') {
    let sent = row?.sent_photos ?? [];
    for (const a of added) sent = withSent(sent, { u: a.url, m: a.gid, o: 'google', at: new Date().toISOString() });
    await deps.saveRow(link.email, { sent_photos: sent }).catch(() => false);
  }
  await deps.log(link.email, 'photo_to_page', added.length === 1 ? 'הוספנו לדף שלכם תמונה מהכרטיס בגוגל' : `הוספנו לדף שלכם ${added.length} תמונות מהכרטיס בגוגל`, null, null);
  return { user_images: serialized, added: added.length, warnings };
}
