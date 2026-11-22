// Where each image of a landing page lives inside the `user_images` JSON column, and how a
// single slot is replaced or cleared. Pure functions (no DB), shared by the image endpoints.
//
// Two stored shapes exist (kept for old pages):
//   array  (upload / stock):  [hero, about, service0..service5, gallery0, gallery1, ...] (gallery starts at index 8)
//   object (AI):              { hero_image_url, icon_urls: [service0..], gallery_urls?: [gallery0..] }
// The object shape may also carry two optional extras, both ignored by anything that does not know them:
//   about_image_url  the array shape's "about" slot (index 1), kept when an array page is converted
//   img_meta         { [image url]: ImgMeta }: alt text, size, smaller variants and focal point per photo
// Photos uploaded since "landing images" (README part 140) are always stored in the object shape, because
// it is the only one that has room for img_meta. Old array pages keep working and are converted on their
// first photo edit (applyImageSlot with meta).
// Slots: 'hero', 'service_<i>', 'gallery_<i>'. Indexes are bounded so a request can never make
// the server allocate a huge array.

/**
 * What the server knows about one stored photo (keyed by the photo's main URL in `img_meta`).
 * Everything is optional: a photo without an entry (every photo stored before part 140, stock and AI
 * images) renders exactly as before, with a contextual fallback alt.
 */
export interface ImgMeta {
  /** Short Hebrew alt text (<= 12 words), written at upload time. */
  alt?: string;
  /** Pixel size of the main URL, so the page can reserve the space (no layout shift) and build a srcset. */
  w?: number;
  h?: number;
  /** A smaller copy (about 640px wide) for phones and thumbnails, and its width. */
  sm?: string;
  smw?: number;
  /** Hero only: a portrait crop (smart-cropped around the subject) for phones, and its size. */
  pm?: string;
  pw?: number;
  ph?: number;
  /** Focal point in percent (0-100), the centre of the most salient part of the photo; used as CSS object-position. */
  fx?: number;
  fy?: number;
  /** The file looks like a logo (small, flat colours or transparent): never the hero, shown contained, never cropped. */
  logo?: boolean;
  /** README part 143: the photo was taken from the business's Google listing (never sent back there), and its Google media id. */
  from?: 'google';
  gid?: string;
}

export type AiStore = {
  hero_image_url: string | null;
  icon_urls: string[];
  gallery_urls?: string[];
  about_image_url?: string;
  img_meta?: Record<string, ImgMeta>;
};
export type ImageStore = AiStore | string[];

export const MAX_SERVICE_SLOTS = 6;
/** Extra photos shown in the page's gallery section (on top of hero, about and the services). */
export const MAX_GALLERY_IMAGES = 12;
/** Upload files accepted when a page is created in the wizard: the hero plus up to 7 gallery photos. */
export const MAX_UPLOAD_IMAGES = 8;

const ARRAY_SERVICE_OFFSET = 2;
// Gallery starts after ALL service slots so a service_3..5 image can never land on a gallery photo.
const ARRAY_GALLERY_OFFSET = ARRAY_SERVICE_OFFSET + MAX_SERVICE_SLOTS;

export type ParsedSlot =
  | { kind: 'hero' }
  | { kind: 'service'; index: number }
  | { kind: 'gallery'; index: number };

export function parseSlot(slot: string | undefined | null): ParsedSlot | null {
  const s = (slot ?? '').trim();
  if (s === 'hero') return { kind: 'hero' };
  const m = /^(service|gallery)_(\d{1,2})$/.exec(s);
  if (!m) return null;
  const index = Number(m[2]);
  const max = m[1] === 'service' ? MAX_SERVICE_SLOTS : MAX_GALLERY_IMAGES;
  if (index >= max) return null;
  return m[1] === 'service' ? { kind: 'service', index } : { kind: 'gallery', index };
}

function padSet(list: string[], index: number, value: string): string[] {
  const out = [...list];
  while (out.length <= index) out.push('');
  out[index] = value;
  return out;
}

/** Drop empty entries at the END only (middle gaps keep their position). */
function trimTail(list: string[]): string[] {
  const out = [...list];
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/**
 * Upload pages created before part 140 have ['', '', photo, photo, photo, ...gallery]: no hero, the
 * photos sit in the service cards. The first service-card photo moves up to the hero slot and the
 * others shift left, so the hero is the first thing a visitor sees. Arrays that already have a hero
 * (or have no photos to promote) are returned unchanged.
 */
export function promoteLegacyHero(arr: string[]): string[] {
  const out = arr.map((x) => x ?? '');
  if (out[0]) return out;
  const services = out.slice(ARRAY_SERVICE_OFFSET, ARRAY_GALLERY_OFFSET);
  const first = services.findIndex(Boolean);
  if (first < 0) return out;
  const hero = services[first];
  const rest = services.filter((_, i) => i !== first);
  while (rest.length < MAX_SERVICE_SLOTS) rest.push('');
  out[0] = hero;
  rest.forEach((u, i) => { out[ARRAY_SERVICE_OFFSET + i] = u; });
  return out;
}

/**
 * Array shape -> object shape, losslessly (hero, about, the 6 service slots and the gallery keep their
 * place). `promoteHero`: upload pages written before the hero-first change have an EMPTY hero slot and
 * their photos in the service cards; the first of those becomes the hero (the same rule the renderer
 * applies on screen, see promoteLegacyHero), so converting a page never changes what the visitor sees.
 */
export function toObjectStore(current: ImageStore | null, promoteHero = false): AiStore {
  if (!current) return { hero_image_url: null, icon_urls: [] };
  if (!Array.isArray(current)) return { ...current, icon_urls: [...(current.icon_urls ?? [])] };
  const arr = promoteHero ? promoteLegacyHero(current) : current.map((x) => x ?? '');
  const services = arr.slice(ARRAY_SERVICE_OFFSET, ARRAY_GALLERY_OFFSET);
  const gallery = arr.slice(ARRAY_GALLERY_OFFSET);
  return {
    hero_image_url: arr[0] || null,
    icon_urls: trimTail(services),
    ...(arr[1] ? { about_image_url: arr[1] } : {}),
    ...(gallery.some(Boolean) ? { gallery_urls: trimTail(gallery) } : {}),
  };
}

/** Keep img_meta entries only for photos the store still shows (replaced and removed photos drop out). */
export function pruneMeta(store: AiStore): AiStore {
  if (!store.img_meta) return store;
  const live = new Set<string>([
    store.hero_image_url ?? '', store.about_image_url ?? '',
    ...(store.icon_urls ?? []), ...(store.gallery_urls ?? []),
  ].filter(Boolean));
  const kept = Object.fromEntries(Object.entries(store.img_meta).filter(([u]) => live.has(u)));
  const { img_meta: _dropped, ...rest } = store;
  void _dropped;
  return Object.keys(kept).length ? { ...rest, img_meta: kept } : rest;
}

/**
 * Put `url` into `slot`. With `meta` (a photo uploaded through the landing-image pipeline) the store is
 * converted to the object shape first, because only that shape can carry img_meta; without it the shape
 * is kept as it was (AI and stock images, and the array callers).
 */
export function applyImageSlot(current: ImageStore | null, slot: ParsedSlot, url: string, meta?: ImgMeta, promoteHero = false): ImageStore {
  if (meta) {
    const base = toObjectStore(current, promoteHero);
    const store: AiStore = {
      ...base,
      icon_urls: [...base.icon_urls],
      ...(base.gallery_urls ? { gallery_urls: [...base.gallery_urls] } : {}),
    };
    if (slot.kind === 'hero') store.hero_image_url = url;
    else if (slot.kind === 'service') store.icon_urls = padSet(store.icon_urls, slot.index, url);
    else store.gallery_urls = padSet(store.gallery_urls ?? [], slot.index, url);
    store.img_meta = { ...(store.img_meta ?? {}), [url]: meta };
    return pruneMeta(store);
  }
  if (Array.isArray(current)) {
    const arr = current.map((x) => x ?? '');
    const i = slot.kind === 'hero' ? 0 : slot.kind === 'service' ? slot.index + ARRAY_SERVICE_OFFSET : slot.index + ARRAY_GALLERY_OFFSET;
    return padSet(arr, i, url);
  }
  const store: AiStore = {
    hero_image_url: current?.hero_image_url ?? null,
    icon_urls: [...(current?.icon_urls ?? [])],
    ...(current?.gallery_urls ? { gallery_urls: [...current.gallery_urls] } : {}),
    ...(current?.about_image_url ? { about_image_url: current.about_image_url } : {}),
    ...(current?.img_meta ? { img_meta: current.img_meta } : {}),
  };
  if (slot.kind === 'hero') store.hero_image_url = url;
  else if (slot.kind === 'service') store.icon_urls = padSet(store.icon_urls, slot.index, url);
  else store.gallery_urls = padSet(store.gallery_urls ?? [], slot.index, url);
  return pruneMeta(store);
}

/** Clears a service or gallery slot (the hero cannot be removed, only replaced). */
export function clearImageSlot(current: ImageStore | null, slot: ParsedSlot): ImageStore | null {
  if (!current || slot.kind === 'hero') return current;
  if (Array.isArray(current)) {
    const i = slot.kind === 'service' ? slot.index + ARRAY_SERVICE_OFFSET : slot.index + ARRAY_GALLERY_OFFSET;
    if (i >= current.length) return current;
    return trimTail(padSet(current.map((x) => x ?? ''), i, ''));
  }
  const store: AiStore = {
    hero_image_url: current.hero_image_url ?? null,
    icon_urls: [...(current.icon_urls ?? [])],
    ...(current.gallery_urls ? { gallery_urls: [...current.gallery_urls] } : {}),
    ...(current.about_image_url ? { about_image_url: current.about_image_url } : {}),
    ...(current.img_meta ? { img_meta: current.img_meta } : {}),
  };
  if (slot.kind === 'service') {
    if (slot.index < store.icon_urls.length) store.icon_urls = padSet(store.icon_urls, slot.index, '');
  } else if (store.gallery_urls && slot.index < store.gallery_urls.length) {
    store.gallery_urls = trimTail(padSet(store.gallery_urls, slot.index, ''));
    if (!store.gallery_urls.length) delete store.gallery_urls;
  }
  return pruneMeta(store);
}

/** A full AI set replaces hero + services; gallery photos the owner added are kept. */
export function galleryOf(current: ImageStore | null): string[] {
  if (!current) return [];
  if (Array.isArray(current)) return current.slice(ARRAY_GALLERY_OFFSET).map((x) => x ?? '');
  return [...(current.gallery_urls ?? [])];
}

export function galleryCount(current: ImageStore | null): number {
  return galleryOf(current).filter(Boolean).length;
}

/**
 * A regenerated AI set replaces hero + services; what the owner added stays: the gallery, the about
 * photo and the alt/size info of the photos that are still there.
 */
export function keepOwnerExtras(current: ImageStore | null, next: AiStore): AiStore {
  if (!current) return next;
  const old = toObjectStore(current);
  const gallery = old.gallery_urls ?? [];
  return pruneMeta({
    ...next,
    ...(gallery.some(Boolean) ? { gallery_urls: gallery } : {}),
    ...(old.about_image_url ? { about_image_url: old.about_image_url } : {}),
    ...(old.img_meta ? { img_meta: old.img_meta } : {}),
  });
}

/**
 * Wizard uploads, array form: the hero comes first, the rest follow in the order they were picked and
 * go to the gallery (the service cards stay empty: their 64px thumbnails used to be the only place an
 * uploaded photo showed). `heroIndex` picks which upload is the hero (see pickHeroIndex in
 * landingImages.ts). Capped at MAX_UPLOAD_IMAGES in total.
 */
export function packUploads(urls: string[], heroIndex = 0): string[] {
  const clean = urls.filter(Boolean).slice(0, MAX_UPLOAD_IMAGES);
  if (!clean.length) return [];
  const h = Math.min(Math.max(0, heroIndex), clean.length - 1);
  const rest = clean.filter((_, i) => i !== h);
  const out: string[] = [clean[h]];
  while (out.length < ARRAY_GALLERY_OFFSET) out.push('');
  if (rest.length) out.push(...rest);
  return rest.length ? out : [clean[h]];
}

/** Wizard uploads, object form, with the per-photo info (alt, sizes, focal point). */
export function packUploadStore(items: Array<{ url: string; meta: ImgMeta }>, heroIndex = 0): AiStore {
  const clean = items.filter((x) => x.url).slice(0, MAX_UPLOAD_IMAGES);
  if (!clean.length) return { hero_image_url: null, icon_urls: [] };
  const h = Math.min(Math.max(0, heroIndex), clean.length - 1);
  const rest = clean.filter((_, i) => i !== h);
  return pruneMeta({
    hero_image_url: clean[h].url,
    icon_urls: [],
    ...(rest.length ? { gallery_urls: rest.map((x) => x.url) } : {}),
    img_meta: Object.fromEntries(clean.map((x) => [x.url, x.meta])),
  });
}

export const GALLERY_ARRAY_OFFSET = ARRAY_GALLERY_OFFSET;
