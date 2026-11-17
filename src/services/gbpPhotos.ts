// Photos for the customer's Google listing (docs/gbp-sync-spec.md, phase 2): any upload becomes a
// JPEG Google accepts, stored at a public URL in our bucket (folder gbp/), which Google then fetches.
// Google's rules: JPG or PNG, 10 KB to 5 MB, at least 250 px (720 px recommended).
// https://developers.google.com/my-business/content/upload-photos

import { createHash, randomBytes } from 'crypto';
import sharp from 'sharp';
import { supabase } from '../config/supabase';
import { uploadImage } from './storage.service';
import { businessPageId } from './seoPageAddon.service';

export const PHOTO_MAX_UPLOAD = 10 * 1024 * 1024;
export const PHOTO_MIN_SIDE = 250;
export const PHOTO_GOOD_SIDE = 720;
const GOOGLE_MAX_BYTES = 5 * 1024 * 1024;
const MAX_LONG_SIDE = 3000;
export const PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export class PhotoInputError extends Error {
  constructor(public readonly code: 'type' | 'size' | 'small' | 'unreadable' | 'not_on_page') { super(code); }
}

export interface Prepared { buffer: Buffer; width: number; height: number; small: boolean }

/** Any accepted image -> a JPEG under Google's limits. Throws PhotoInputError. */
export async function toGooglePhoto(input: Buffer, mime: string): Promise<Prepared> {
  if (!PHOTO_MIMES.includes(mime)) throw new PhotoInputError('type');
  if (!input.length || input.length > PHOTO_MAX_UPLOAD) throw new PhotoInputError('size');
  let meta;
  try { meta = await sharp(input).metadata(); } catch { throw new PhotoInputError('unreadable'); }
  // EXIF orientation 5-8 swaps width and height.
  const swap = (meta.orientation ?? 1) >= 5;
  const w = (swap ? meta.height : meta.width) ?? 0, h = (swap ? meta.width : meta.height) ?? 0;
  if (Math.min(w, h) < PHOTO_MIN_SIDE) throw new PhotoInputError('small');
  for (const quality of [86, 76, 64]) {
    const { data, info } = await sharp(input).rotate()
      .resize({ width: MAX_LONG_SIDE, height: MAX_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (data.length <= GOOGLE_MAX_BYTES) return { buffer: data, width: info.width, height: info.height, small: Math.min(info.width, info.height) < PHOTO_GOOD_SIDE };
  }
  throw new PhotoInputError('size');
}

/** Stores the JPEG publicly under gbp/<owner hash>/ and returns its URL. */
export async function storeGooglePhoto(email: string, jpeg: Buffer, store = uploadImage): Promise<string> {
  const owner = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
  return store(jpeg, `${owner}/${Date.now()}-${randomBytes(4).toString('hex')}.jpg`, 'image/jpeg', 'gbp');
}

// ── An image from the business's own landing page ───────────────────────────

/** Hosts our page images come from: our storage, Unsplash, fal.ai. Nothing else is ever fetched. */
export function allowedImageHost(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const ours = [process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL].map((x) => { try { return x ? new URL(x).host : ''; } catch { return ''; } }).filter(Boolean);
  const h = u.host.toLowerCase();
  return ours.includes(h) || h === 'images.unsplash.com' || h === 'fal.media' || h.endsWith('.fal.media');
}

/** All https image URLs stored on the business's own page (images, logo, gallery). */
export async function pageImageUrls(email: string): Promise<string[]> {
  const id = await businessPageId(email);
  if (!id) return [];
  const { data } = await supabase.from('landing_pages').select('*').eq('id', id).eq('owner_email', email).maybeSingle();
  if (!data) return [];
  const found = JSON.stringify(data).match(/https:\/\/[^"\s\\]+/g) ?? [];
  return [...new Set(found)].filter((u) => allowedImageHost(u) && /\.(jpe?g|png|webp)(\?|$)|images\.unsplash\.com|fal\.media/i.test(u));
}

/**
 * The bytes of an image that is on the business's page. Only a URL that the page itself holds, on an
 * allowed host, is fetched (no redirects, 10 s, 10 MB): a customer can never make us fetch anything else.
 */
export async function fetchPageImage(email: string, url: string, f: typeof fetch = fetch, urls = pageImageUrls): Promise<{ buffer: Buffer; mime: string }> {
  if (!allowedImageHost(url) || !(await urls(email)).includes(url)) throw new PhotoInputError('not_on_page');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const r = await f(url, { redirect: 'error', signal: ctrl.signal });
    if (!r.ok) throw new PhotoInputError('unreadable');
    const mime = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > PHOTO_MAX_UPLOAD) throw new PhotoInputError('size');
    const buffer = Buffer.from(await r.arrayBuffer());
    if (buffer.length > PHOTO_MAX_UPLOAD) throw new PhotoInputError('size');
    return { buffer, mime: PHOTO_MIMES.includes(mime) ? mime : 'image/jpeg' };
  } catch (e) {
    if (e instanceof PhotoInputError) throw e;
    throw new PhotoInputError('unreadable');
  } finally { clearTimeout(timer); }
}
