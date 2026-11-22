// The business's landing page and its Google listing, shared both ways (README part 143). Pure rules,
// no I/O: which reviews the page shows and when, what of the business card the page states as its
// practical details, which page photos may go to the listing, and what the owner's setting means.
//
// Google sources:
//   Reviews of the owner's OWN listing, read with the Business Profile API (OAuth, scope business.manage):
//   https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list
//   Photos: https://developers.google.com/my-business/content/upload-photos (JPG or PNG, 10 KB to 5 MB,
//   at least 250 px), https://developers.google.com/my-business/content/limits (10 edits a minute per listing).

import type { GbpReview } from './gbpGoogle';
import type { TruthCard, TruthHours } from './businessTruth';
import type { AttributeMeta } from './gbpAttributes';
import type { ImageStore, ImgMeta } from './imageSlots';
import type { PhotosMode } from './automation.service';

// ── Reviews ──────────────────────────────────────────────────────────────────

/** Display threshold (owner decision pending): under either one the section is simply not drawn. */
export const REVIEWS_MIN_COUNT = 5;
export const REVIEWS_MIN_RATING = 4.3;
/** How many reviews the page shows (3 or 4). */
export const REVIEWS_SHOWN = 4;
/** Google is read again after this long (a page view after it starts a refresh in the background). */
export const REVIEWS_TTL_MS = 24 * 3_600_000;
/** Older than this the cache is not shown at all (the refresh keeps failing: the connection is likely broken). */
export const REVIEWS_MAX_AGE_MS = 7 * 86_400_000;
/** The section id the owner's quiet switch in the editor hides (ai_content.hidden_sections). */
export const REVIEWS_SECTION_ID = 'google_reviews';

export interface PageReview { name: string | null; rating: number; date: string; text: string }
export interface PageReviews { rating: number; count: number; items: PageReview[]; mapsUrl: string | null; fetchedAt: string }

/**
 * The words the reviewer wrote. When the reviewer's language differs from the reader's, Google's v4 answer
 * holds "(Translated by Google) <translation>\n\n(Original)\n<original>": the page shows the original only,
 * never Google's translation and never a text of ours. Nothing inside the text is changed.
 */
export function originalText(comment: string): string {
  const s = (comment ?? '').trim();
  const orig = /\(Original\)\s*\n([\s\S]+)$/.exec(s);
  if (orig) return orig[1].trim();
  const tr = s.indexOf('(Translated by Google)');
  if (tr > 0) return s.slice(0, tr).trim();
  if (tr === 0) return '';   // a translation without the original: not the reviewer's words
  return s;
}

/** First name only (the full name stays on Google). Nothing that looks like a link, an email or "A Google User". */
export function firstName(display: string | null | undefined): string | null {
  const s = (display ?? '').replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ').trim();
  if (!s || /@|https?:|www\./i.test(s) || /^a google user$/i.test(s)) return null;
  const first = s.split(/\s+/)[0].replace(/[.,;:!?]+$/, '');
  return first && first.length <= 30 ? first : null;
}

const DAY = 86_400_000;

/** A detailed, recent, 4-5 star review scores higher. Exported for the tests. */
export function reviewScore(r: { rating: number; createdAt: string; text: string }, now: Date): number {
  const len = r.text.length;
  const ageDays = Math.max(0, (now.getTime() - Date.parse(r.createdAt)) / DAY);
  const recency = ageDays <= 365 ? 3 * (1 - ageDays / 365) : ageDays <= 730 ? 0 : -2;
  const detail = Math.min(len, 400) / 100 - (len > 700 ? 1 : 0);   // long enough to say something, not a wall of text
  return (r.rating === 5 ? 2 : 0) + recency + detail;
}

/**
 * The 3-4 reviews the page shows: 4 or 5 stars with a written text (at least 20 characters, preferring 60+),
 * the best by detail and recency, shown newest first. Never a review of 3 stars or fewer, never an empty one.
 */
export function selectReviews(list: GbpReview[], now: Date, n = REVIEWS_SHOWN): PageReview[] {
  const withText = list
    .map((r) => ({ ...r, text: originalText(r.text) }))
    .filter((r) => r.rating >= 4 && r.text.length >= 20 && !Number.isNaN(Date.parse(r.createdAt)));
  const detailed = withText.filter((r) => r.text.length >= 60);
  const pool = detailed.length >= Math.min(n, 3) ? detailed : withText;
  return pool
    .map((r) => ({ r, s: reviewScore(r, now) }))
    .sort((a, b) => b.s - a.s || Date.parse(b.r.createdAt) - Date.parse(a.r.createdAt))
    .slice(0, n)
    .map(({ r }) => r)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((r) => ({ name: firstName(r.reviewer), rating: r.rating, date: r.createdAt.slice(0, 10), text: r.text }));
}

/** At or over the threshold: at least REVIEWS_MIN_COUNT reviews and an overall REVIEWS_MIN_RATING or more. */
export function meetsThreshold(rating: number, count: number): boolean {
  return count >= REVIEWS_MIN_COUNT && Math.round(rating * 10) / 10 >= REVIEWS_MIN_RATING;
}

/** What is stored and shown, or null when there is nothing to show (under the threshold, or no review with text). */
export function buildPageReviews(list: GbpReview[], summary: { average: number; total: number } | null, mapsUrl: string | null, now: Date): PageReviews | null {
  if (!summary || !meetsThreshold(summary.average, summary.total)) return null;
  const items = selectReviews(list, now);
  if (!items.length) return null;
  return { rating: Math.round(summary.average * 10) / 10, count: summary.total, items, mapsUrl: mapsUrl && /^https:\/\//.test(mapsUrl) ? mapsUrl : null, fetchedAt: now.toISOString() };
}

/** The cache is fresh enough to skip a refresh. */
export const reviewsFresh = (fetchedAt: string | null | undefined, now: Date): boolean =>
  !!fetchedAt && now.getTime() - Date.parse(fetchedAt) < REVIEWS_TTL_MS;

/** The cache may still be shown (a failed refresh keeps the last good reviews for a while, not forever). */
export const reviewsShowable = (fetchedAt: string | null | undefined, now: Date): boolean =>
  !!fetchedAt && now.getTime() - Date.parse(fetchedAt) < REVIEWS_MAX_AGE_MS;

/** Visitors do not get the reviews when the owner hid the section; the owner still does (to switch it back on). */
export function reviewsForViewer(r: PageReviews | null, hiddenSections: unknown, isOwner: boolean): PageReviews | null {
  if (!r) return null;
  const hidden = Array.isArray(hiddenSections) && hiddenSections.includes(REVIEWS_SECTION_ID);
  return hidden && !isOwner ? null : r;
}

// ── Practical details from the business card ─────────────────────────────────

export interface FactAttr { id: string; label: string }
export interface PageFacts { phone: string; address: string; hours: TruthHours[]; areas: string[]; parking: FactAttr[]; accessibility: FactAttr[] }

const ACCESS_RE = /wheelchair|accessib|hearing_loop|assistive/i;
const PARKING_RE = /parking/i;

/**
 * The page's practical details as the business card holds them (the card follows Google, and the dashboard
 * writes to both). Only what has a value is returned; the page keeps its own text for the rest.
 *   - an address the listing hides (serves customers only at their place) is never shown;
 *   - a business Google marks closed shows no opening hours;
 *   - only attributes set to YES, grouped into accessibility and parking, with their Hebrew name from Google.
 */
export function pageFacts(card: TruthCard, meta: readonly AttributeMeta[] = []): PageFacts {
  const label = new Map(meta.map((m) => [m.name, m.label]));
  const attrs = Object.entries(card.attributes ?? {}).filter(([, v]) => v === true).map(([k]) => k).sort();
  const pick = (re: RegExp, not?: RegExp) => attrs.filter((k) => re.test(k) && !(not && not.test(k))).map((k) => ({ id: k.replace(/^attributes\//, ''), label: label.get(k) ?? '' }));
  const hidden = card.serviceArea?.type === 'CUSTOMER_LOCATION_ONLY';
  return {
    phone: card.phone || '',
    address: hidden ? '' : card.address || '',
    hours: card.open ? card.hours ?? [] : [],
    areas: (card.serviceArea?.places ?? []).map((p) => p.name).filter(Boolean).slice(0, 20),
    accessibility: pick(ACCESS_RE),
    parking: pick(PARKING_RE, ACCESS_RE),
  };
}

const DAY_SHORT_HE: Record<string, string> = { SUNDAY: 'א׳', MONDAY: 'ב׳', TUESDAY: 'ג׳', WEDNESDAY: 'ד׳', THURSDAY: 'ה׳', FRIDAY: 'ו׳', SATURDAY: 'ש׳' };
const ORDER = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Opening hours as the page's text ("א׳-ה׳ 09:00-19:00\nו׳ 08:00-14:00"): consecutive days with the same hours are one line. */
export function hoursLines(hours: readonly TruthHours[], dayName: (day: string) => string = (d) => DAY_SHORT_HE[d] ?? d, dash = '-'): string {
  const spanOf = (d: string) => hours.filter((h) => h.day === d).map((h) => `${h.open}-${h.close}`).join(', ');
  const lines: string[] = [];
  let i = 0;
  while (i < ORDER.length) {
    const s = spanOf(ORDER[i]);
    if (!s) { i++; continue; }
    let j = i;
    while (j + 1 < ORDER.length && spanOf(ORDER[j + 1]) === s) j++;
    lines.push(`${j > i ? `${dayName(ORDER[i])}${dash}${dayName(ORDER[j])}` : dayName(ORDER[i])} ${s}`);
    i = j + 1;
  }
  return lines.join('\n');
}

/**
 * The page content with the card's details in place of the page's own (server-rendered SEO body and JSON-LD,
 * so search engines read the same phone, address and hours visitors see). Hours only for the Hebrew page:
 * the other languages keep their translated text there.
 */
export function withCardFacts<T>(content: T, facts: PageFacts | null | undefined, lang = 'he'): T {
  if (!facts || !content || typeof content !== 'object') return content;
  const c = content as Record<string, any>;
  const contact = { ...(c.contact ?? {}) };
  if (facts.phone) contact.phone = facts.phone;
  if (facts.address) contact.address = facts.address;
  if (lang === 'he' && facts.hours.length) contact.business_hours = hoursLines(facts.hours);
  return { ...c, contact } as T;
}

// ── Photos ───────────────────────────────────────────────────────────────────

export const GOOGLE_MIN_SIDE = 250;
/** One photo to Google every 6.5 seconds: under Google's 10 edits a minute per listing, with room for the owner's own edits. */
export const SEND_GAP_MS = 6500;
export const MAX_SENT_RECORDS = 400;

export interface SentPhoto { u: string; h?: string; m?: string | null; o: 'page' | 'manual' | 'google'; at: string }
export interface PagePhoto { url: string; w: number; h: number }
export type PhotoSkip = 'logo' | 'small' | 'not_uploaded' | 'from_google' | 'host';

/** Every photo URL the page holds, with its stored details (hero, service cards, gallery, about). */
export function pagePhotos(store: ImageStore | null): Array<{ url: string; meta: ImgMeta | undefined }> {
  if (!store) return [];
  if (Array.isArray(store)) return [...new Set(store.filter((u): u is string => typeof u === 'string' && !!u))].map((url) => ({ url, meta: undefined }));
  const meta = store.img_meta ?? {};
  const urls = [store.hero_image_url, store.about_image_url, ...(store.icon_urls ?? []), ...(store.gallery_urls ?? [])].filter((u): u is string => typeof u === 'string' && !!u);
  return [...new Set(urls)].map((url) => ({ url, meta: meta[url] }));
}

/**
 * May this page photo go to the Google listing by itself? Only a photo the OWNER uploaded (it went through our
 * upload pipeline, so it has stored sizes; stock and generated pictures have none and must not stand for the
 * business on Google), on our own storage, not the logo, not a photo that came from Google, at least 250 px.
 */
export function photoEligibility(p: { url: string; meta: ImgMeta | undefined }, logoUrl: string | null, ourHost: (url: string) => boolean): { ok: true } | { ok: false; reason: PhotoSkip } {
  if (!ourHost(p.url)) return { ok: false, reason: 'host' };
  if (p.meta?.from === 'google') return { ok: false, reason: 'from_google' };
  if (!p.meta || !p.meta.w || !p.meta.h) return { ok: false, reason: 'not_uploaded' };
  if (p.meta.logo || (logoUrl && p.url === logoUrl)) return { ok: false, reason: 'logo' };
  if (Math.min(p.meta.w, p.meta.h) < GOOGLE_MIN_SIDE) return { ok: false, reason: 'small' };
  return { ok: true };
}

/**
 * The format Google gets: JPG and PNG are accepted by Google; our page photos are WebP, which Google does not
 * accept, so they become JPEG. Every photo is re-encoded to a JPEG under 5 MB (gbpPhotos.toGooglePhoto) either
 * way; this says whether a conversion of format is needed. null = not an image we send.
 */
export function googleFormat(mime: string): 'as_is' | 'to_jpeg' | null {
  const m = (mime || '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/png') return 'as_is';
  if (m === 'image/webp') return 'to_jpeg';
  return null;
}

/** Already sent (by URL, or the same bytes under another URL), or taken from Google: never sent again. */
export function alreadySent(sent: readonly SentPhoto[], url: string, hash?: string | null): boolean {
  return sent.some((s) => s.u === url || (!!hash && !!s.h && s.h === hash));
}

/** The page photos that may go to Google and were not sent yet, in page order. */
export function newPagePhotos(store: ImageStore | null, logoUrl: string | null, sent: readonly SentPhoto[], ourHost: (url: string) => boolean): PagePhoto[] {
  return pagePhotos(store)
    .filter((p) => photoEligibility(p, logoUrl, ourHost).ok && !alreadySent(sent, p.url))
    .map((p) => ({ url: p.url, w: p.meta!.w!, h: p.meta!.h! }));
}

/** Adds a record (newest last), dropping the oldest beyond MAX_SENT_RECORDS. */
export function withSent(sent: readonly SentPhoto[], rec: SentPhoto): SentPhoto[] {
  return [...sent.filter((s) => s.u !== rec.u), rec].slice(-MAX_SENT_RECORDS);
}

export function readSent(v: unknown): SentPhoto[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is SentPhoto => !!s && typeof s === 'object' && typeof (s as SentPhoto).u === 'string' && ['page', 'manual', 'google'].includes((s as SentPhoto).o));
}

/**
 * What a new page photo leads to:
 *   send     the owner's setting is "auto", the sync to Google is on, the page is the connected business's page;
 *   suggest  setting "ask" (or "auto" while the sync to Google is still off): shown in the dashboard with a button;
 *   none     setting "off", no connection, or nowhere to remember what was sent (migration 055 not run).
 */
export function photoAction(o: { mode: PhotosMode; writeEnabled: boolean; linked: boolean; migrated: boolean }): 'send' | 'suggest' | 'none' {
  if (!o.linked || !o.migrated || o.mode === 'off') return 'none';
  if (o.mode === 'auto' && o.writeEnabled) return 'send';
  return 'suggest';
}

// ── Photos from Google to the page ───────────────────────────────────────────

/** Google serves listing photos from its own image hosts; nothing else is ever fetched. */
export function googlePhotoHost(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const h = u.hostname.toLowerCase();
  return h.endsWith('.googleusercontent.com') || h.endsWith('.ggpht.com');
}
