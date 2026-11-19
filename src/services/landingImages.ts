// Landing-page photos: what happens to a picture the customer uploads (README part 140).
//
//   analyze   size, a blur estimate and a "does this look like a logo" estimate (cheap, from small copies)
//   decide    the hero is the best of the uploads (landscape and large first, never a logo-looking file)
//   store     main copy (1600 wide for the hero, 1200 for the rest), a ~640 wide copy for phones, and for
//             the hero a portrait 2:3 crop for phones; all WebP, all through sharp's attention strategy where a crop is needed
//   describe  a short Hebrew alt text (a vision model when a key is set, otherwise a plain contextual sentence)
//   warn      a quiet, never blocking hint when the photo is small, blurry or looks like a logo
//
// The decisions are pure functions (no sharp, no network) so scripts/test-landing-images.ts can pin them;
// the sharp part takes its storage and alt-text functions as arguments for the same reason.
import sharp from 'sharp';
import type { Metadata, OutputInfo } from 'sharp';
import { packUploadStore, type AiStore, type ImgMeta } from './imageSlots';

// ─── Sizes ────────────────────────────────────────────────────────────────────

/** Width of the main copy: the hero fills the screen, everything else is shown much smaller. */
export const HERO_MAIN_W = 1600;
export const PHOTO_MAIN_W = 1200;
/** The small copy served to phones and used for thumbnails. */
export const SM_W = 640;
/** The hero's portrait crop for phones (2:3, fills a phone screen). */
export const PM_W = 800;
export const PM_H = 1200;
/** A small copy is skipped when the original is not much wider than it (nothing to save). */
const SM_SKIP_BELOW = SM_W + 120;

export const WEBP_MAIN_Q = 80;
export const WEBP_SM_Q = 74;
export const WEBP_PM_Q = 76;

// ─── Quality rules (pure) ─────────────────────────────────────────────────────

export const QUALITY = {
  /** The hero fills the screen: below this on the short side it looks soft on a phone. */
  heroMinSide: 800,
  photoMinSide: 500,
  photoMinPixels: 300_000,
  /** 90th-percentile Laplacian variance of 32px blocks of a 512px copy; below this nothing in the photo is sharp. */
  blurMin: 30,
  /** Logo-looking: share of transparent pixels, share of the dominant colour, and how many colours matter. */
  logoTransparent: 0.3,
  logoDominant: 0.55,
  logoMaxColors: 7,
  logoMaxSide: 1400,
} as const;

export type WarningCode = 'small' | 'blurry' | 'logo';
export interface ImageWarning { code: WarningCode; message: string; index?: number; fileName?: string }

export const WARNING_TEXT: Record<WarningCode, string> = {
  small: 'התמונה קטנה, בדף היא עלולה להיראות לא חדה. אפשר להמשיך, או להעלות תמונה גדולה יותר.',
  blurry: 'התמונה נראית מטושטשת, בדף היא עלולה להיראות לא חדה. אפשר להמשיך, או להעלות תמונה חדה יותר.',
  logo: 'הקובץ הזה נראה כמו לוגו. אפשר להמשיך, אבל כדאי להעלות את הלוגו בשדה הלוגו, ובתמונות להעלות תמונות מהעבודה שלכם.',
};

export interface PhotoAnalysis {
  /** Size after the EXIF rotation. */
  width: number;
  height: number;
  /** Sharpness of the sharpest parts (see QUALITY.blurMin); null when it could not be measured. */
  sharpness: number | null;
  transparentRatio: number;
  dominantRatio: number;
  significantColors: number;
}

export function looksLikeLogo(a: Pick<PhotoAnalysis, 'width' | 'height' | 'transparentRatio' | 'dominantRatio' | 'significantColors'>): boolean {
  const aspect = a.width / Math.max(1, a.height);
  if (aspect < 0.4 || aspect > 2.8) return false;
  if (a.transparentRatio >= QUALITY.logoTransparent) return true;
  const flat = a.dominantRatio >= QUALITY.logoDominant && a.significantColors <= QUALITY.logoMaxColors;
  return flat && Math.max(a.width, a.height) <= QUALITY.logoMaxSide;
}

export function isSmall(a: Pick<PhotoAnalysis, 'width' | 'height'>, role: 'hero' | 'photo'): boolean {
  const side = Math.min(a.width, a.height);
  if (role === 'hero') return side < QUALITY.heroMinSide;
  return side < QUALITY.photoMinSide || a.width * a.height < QUALITY.photoMinPixels;
}

export function isBlurry(a: Pick<PhotoAnalysis, 'sharpness'>): boolean {
  return a.sharpness !== null && a.sharpness < QUALITY.blurMin;
}

/** One quiet hint per photo, most useful first. Never a reason to refuse the file. */
export function assessQuality(a: PhotoAnalysis, role: 'hero' | 'photo'): WarningCode | null {
  if (looksLikeLogo(a)) return 'logo';
  if (isSmall(a, role)) return 'small';
  if (isBlurry(a)) return 'blurry';
  return null;
}

/**
 * Which upload becomes the hero: the first one, unless another is clearly better as a wide opening
 * image (landscape and large). A logo-looking file is never chosen while a real photo exists, and a
 * small or blurry one is a last resort. Ties go to the earlier file.
 */
export function pickHeroIndex(items: Array<Pick<PhotoAnalysis, 'width' | 'height' | 'sharpness'> & { logo?: boolean }>): number {
  if (!items.length) return 0;
  const score = (x: (typeof items)[number], i: number) => {
    const aspect = x.width / Math.max(1, x.height);
    let s = Math.min(Math.max(aspect, 0.6), 1.8);                       // landscape up to 1.8:1 is best
    s += Math.min(Math.min(x.width, x.height) / 1200, 1);               // resolution of the short side
    if (isSmall(x, 'hero')) s -= 0.8;
    if (isBlurry(x)) s -= 0.8;
    if (x.logo) s -= 5;
    if (i === 0) s += 0.15;                                             // the first photo is the customer's own choice
    return s;
  };
  let best = 0;
  let bestScore = -Infinity;
  items.forEach((x, i) => { const sc = score(x, i); if (sc > bestScore + 1e-9) { best = i; bestScore = sc; } });
  return best;
}

// ─── Focal point and crops (pure) ─────────────────────────────────────────────

/** A 0..1 position as a whole percent, clamped (the CSS object-position that keeps the subject in view). */
export function toPercent(v: number): number {
  return Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v * 100))) : 50;
}

/** Size of the hero's portrait crop for a source: the biggest 2:3 box that fits, never enlarged. */
export function portraitCropSize(w: number, h: number): { w: number; h: number } {
  let cw: number;
  let ch: number;
  if (w / h > PM_W / PM_H) { ch = h; cw = Math.round(h * (PM_W / PM_H)); } else { cw = w; ch = Math.round(w * (PM_H / PM_W)); }
  const k = Math.min(1, PM_W / cw, PM_H / ch);
  return { w: Math.max(1, Math.round(cw * k)), h: Math.max(1, Math.round(ch * k)) };
}

// ─── Alt text (pure part) ─────────────────────────────────────────────────────

/** Used whenever there is no key, the call fails or the answer is unusable: plain, true, contextual. */
export function fallbackAlt(businessName: string): string {
  const name = (businessName ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return name ? `תמונה מהעבודה של ${name}` : 'תמונה מהעבודה שלנו';
}

/** The model's answer, tidied: one line, no quotes, at most 12 words; anything unusable becomes the fallback. */
export function sanitizeAlt(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const t = raw.replace(/[\r\n]+/g, ' ').replace(/["“”„'`*#]/g, '').replace(/\s+/g, ' ').trim();
  if (!t || !/[֐-׿]/.test(t)) return fallback;           // Hebrew only: this page is Hebrew
  const words = t.split(' ');
  const cut = words.length > 12 ? words.slice(0, 12).join(' ') : t;
  return cut.replace(/[.,;:\s]+$/, '');
}

// ─── Measuring (pure on raw pixels) ───────────────────────────────────────────

/** Variance of the 3x3 Laplacian inside each 32px block; the 90th percentile says how sharp the sharpest parts are. */
export function blockSharpness(gray: Uint8Array, w: number, h: number): number | null {
  const B = 32;
  if (w < B * 2 || h < B * 2) return null;
  const vars: number[] = [];
  for (let by = 1; by + B < h; by += B) {
    for (let bx = 1; bx + B < w; bx += B) {
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let y = by; y < by + B && y < h - 1; y++) {
        for (let x = bx; x < bx + B && x < w - 1; x++) {
          const i = y * w + x;
          const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
          sum += lap;
          sumSq += lap * lap;
          n++;
        }
      }
      if (n) vars.push(sumSq / n - (sum / n) * (sum / n));
    }
  }
  if (!vars.length) return null;
  vars.sort((a, b) => a - b);
  return vars[Math.min(vars.length - 1, Math.floor(vars.length * 0.9))];
}

/** Colour statistics of a small RGBA copy: transparent share, the dominant colour's share, how many colours matter. */
export function colorStats(rgba: Uint8Array, pixels: number): Pick<PhotoAnalysis, 'transparentRatio' | 'dominantRatio' | 'significantColors'> {
  let transparent = 0;
  const buckets = new Map<number, number>();
  let opaque = 0;
  for (let p = 0; p < pixels; p++) {
    const o = p * 4;
    if (rgba[o + 3] < 32) { transparent++; continue; }
    opaque++;
    const key = ((rgba[o] >> 4) << 8) | ((rgba[o + 1] >> 4) << 4) | (rgba[o + 2] >> 4);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  let top = 0;
  let significant = 0;
  buckets.forEach((n) => { if (n > top) top = n; if (n >= opaque * 0.015) significant++; });
  return {
    transparentRatio: pixels ? transparent / pixels : 0,
    dominantRatio: opaque ? top / opaque : 0,
    significantColors: significant,
  };
}

// ─── sharp: analysis, focal point, processing ─────────────────────────────────

function orientedSize(meta: Metadata): { width: number; height: number } {
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  return (meta.orientation ?? 1) >= 5 ? { width: h, height: w } : { width: w, height: h };
}

export async function analyzePhoto(buffer: Buffer): Promise<PhotoAnalysis> {
  const base = sharp(buffer, { failOn: 'none' }).rotate();
  const { width, height } = orientedSize(await sharp(buffer, { failOn: 'none' }).metadata());
  if (!width || !height) throw new Error('unreadable image');

  let sharpness: number | null = null;
  try {
    const g = await base.clone().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    sharpness = blockSharpness(new Uint8Array(g.data), g.info.width, g.info.height);
  } catch { /* a photo we cannot measure is never called blurry */ }

  let stats = { transparentRatio: 0, dominantRatio: 0, significantColors: 99 };
  try {
    const c = await base.clone().resize({ width: 48, height: 48, fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    stats = colorStats(new Uint8Array(c.data), c.info.width * c.info.height);
  } catch { /* no colour stats: not a logo */ }

  return { width, height, sharpness, ...stats };
}

/**
 * Where the subject is, as {fx, fy} in percent. sharp's attention strategy (skin tones, saturation,
 * brightness, edges) reports the centre of the most salient region while it crops; asking for a crop
 * of a 320px copy that is narrower than the picture gives that centre in the picture's own frame.
 * A few milliseconds.
 */
export async function computeFocal(buffer: Buffer): Promise<{ fx: number; fy: number }> {
  try {
    const small = await sharp(buffer, { failOn: 'none' }).rotate()
      .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).png().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = small.info;
    if (w < 8 || h < 8) return { fx: 50, fy: 50 };
    // A window half as wide as the picture: scale stays 1, so the reported point is in this frame.
    const r = await sharp(small.data).resize(Math.max(1, Math.round(w / 2)), h, { fit: 'cover', position: sharp.strategy.attention }).toBuffer({ resolveWithObject: true });
    const info = r.info as OutputInfo;
    if (typeof info.attentionX !== 'number' || typeof info.attentionY !== 'number') return { fx: 50, fy: 50 };
    return { fx: toPercent(info.attentionX / w), fy: toPercent(info.attentionY / h) };
  } catch {
    return { fx: 50, fy: 50 };
  }
}

export type Uploader = (data: Buffer, filename: string) => Promise<string>;
export type AltMaker = (jpeg: Buffer, ctx: { businessName: string }) => Promise<string>;

async function defaultUploader(data: Buffer, filename: string): Promise<string> {
  const { uploadImage } = await import('./storage.service');
  return uploadImage(data, filename, 'image/webp');
}

async function defaultAlt(jpeg: Buffer, ctx: { businessName: string }): Promise<string> {
  const { generatePhotoAlt } = await import('./imageAlt');
  return generatePhotoAlt(jpeg, ctx);
}

export interface ProcessedPhoto {
  url: string;
  meta: ImgMeta;
  warning: ImageWarning | null;
  analysis: PhotoAnalysis;
  /** Bytes stored per variant (for logs and the page-weight report). */
  bytes: { main: number; sm: number; pm: number };
}

/**
 * Store one customer photo. Throws only when the file cannot be read or stored; every quality problem is
 * a warning on the result, never a refusal.
 */
export async function processPhoto(
  buffer: Buffer,
  opts: {
    role: 'hero' | 'photo';
    businessName: string;
    prefix?: string;
    analysis?: PhotoAnalysis;
    upload?: Uploader;
    makeAlt?: AltMaker;
  },
): Promise<ProcessedPhoto> {
  const upload = opts.upload ?? defaultUploader;
  const makeAlt = opts.makeAlt ?? defaultAlt;
  const analysis = opts.analysis ?? await analyzePhoto(buffer);
  const logo = looksLikeLogo(analysis);
  const isHero = opts.role === 'hero' && !logo;
  const base = sharp(buffer, { failOn: 'none' }).rotate();

  const main = await base.clone()
    .resize({ width: isHero ? HERO_MAIN_W : PHOTO_MAIN_W, withoutEnlargement: true })
    .webp(logo ? { quality: 88, alphaQuality: 100 } : { quality: WEBP_MAIN_Q })
    .toBuffer({ resolveWithObject: true });

  const wantSm = !logo && main.info.width >= SM_SKIP_BELOW;
  const sm = wantSm
    ? await base.clone().resize({ width: SM_W, withoutEnlargement: true }).webp({ quality: WEBP_SM_Q }).toBuffer({ resolveWithObject: true })
    : null;

  let pm: { data: Buffer; info: OutputInfo } | null = null;
  if (isHero) {
    const t = portraitCropSize(analysis.width, analysis.height);
    pm = await base.clone().flatten({ background: '#ffffff' })
      .resize(t.w, t.h, { fit: 'cover', position: sharp.strategy.attention })
      .webp({ quality: WEBP_PM_Q }).toBuffer({ resolveWithObject: true });
  }

  const focal = logo ? { fx: 50, fy: 50 } : await computeFocal(buffer);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prefix = opts.prefix ?? 'image';
  const fallback = fallbackAlt(opts.businessName);
  const altSource = sm?.data ?? main.data;

  const [url, smUrl, pmUrl, alt] = await Promise.all([
    upload(main.data, `${prefix}-${stamp}.webp`),
    sm ? upload(sm.data, `${prefix}-${stamp}-s.webp`) : Promise.resolve(null),
    pm ? upload(pm.data, `${prefix}-${stamp}-m.webp`) : Promise.resolve(null),
    (async () => {
      try {
        const jpeg = await sharp(altSource).flatten({ background: '#ffffff' }).resize({ width: 512, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
        return sanitizeAlt(await makeAlt(jpeg, { businessName: opts.businessName }), fallback);
      } catch { return fallback; }
    })(),
  ]);

  const meta: ImgMeta = {
    alt,
    w: main.info.width,
    h: main.info.height,
    ...(smUrl && sm ? { sm: smUrl, smw: sm.info.width } : {}),
    ...(pmUrl && pm ? { pm: pmUrl, pw: pm.info.width, ph: pm.info.height } : {}),
    ...(logo ? { logo: true } : { fx: focal.fx, fy: focal.fy }),
  };

  const code = assessQuality(analysis, opts.role);
  console.log('[IMAGE] landing photo stored', { role: opts.role, w: main.info.width, h: main.info.height, main: main.data.length, sm: sm?.data.length ?? 0, pm: pm?.data.length ?? 0, warning: code });
  return {
    url, meta, analysis,
    warning: code ? { code, message: WARNING_TEXT[code] } : null,
    bytes: { main: main.data.length, sm: sm?.data.length ?? 0, pm: pm?.data.length ?? 0 },
  };
}

/**
 * The wizard's uploads: analyse them all, choose the hero, store everything (the photos in parallel) and
 * build the stored JSON. Warnings carry the file's position and name so the wizard can say which one.
 */
export async function processUploadedPhotos(
  files: Array<{ buffer: Buffer; name?: string }>,
  opts: { businessName: string; upload?: Uploader; makeAlt?: AltMaker },
): Promise<{ store: AiStore; warnings: ImageWarning[]; processed: ProcessedPhoto[] }> {
  const list = files.slice(0, 8);
  const analyses = await Promise.all(list.map((f) => analyzePhoto(f.buffer)));
  const heroIndex = pickHeroIndex(analyses.map((a) => ({ ...a, logo: looksLikeLogo(a) })));
  const processed = await Promise.all(list.map((f, i) => processPhoto(f.buffer, {
    role: i === heroIndex ? 'hero' : 'photo',
    businessName: opts.businessName,
    analysis: analyses[i],
    upload: opts.upload,
    makeAlt: opts.makeAlt,
  })));
  const warnings: ImageWarning[] = [];
  processed.forEach((p, i) => {
    if (p.warning) warnings.push({ ...p.warning, index: i, ...(list[i].name ? { fileName: list[i].name } : {}) });
  });
  const store = packUploadStore(processed.map((p) => ({ url: p.url, meta: p.meta })), heroIndex);
  return { store, warnings, processed };
}
