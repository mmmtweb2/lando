// Where each image of a landing page lives inside the `user_images` JSON column, and how a
// single slot is replaced or cleared. Pure functions (no DB), shared by the image endpoints.
//
// Two stored shapes exist (kept for old pages):
//   array  (upload / stock):  [hero, about, service0..service5, gallery0, gallery1, ...] (gallery starts at index 8)
//   object (AI):              { hero_image_url, icon_urls: [service0..], gallery_urls?: [gallery0..] }
// Slots: 'hero', 'service_<i>', 'gallery_<i>'. Indexes are bounded so a request can never make
// the server allocate a huge array.

export type AiStore = { hero_image_url: string | null; icon_urls: string[]; gallery_urls?: string[] };
export type ImageStore = AiStore | string[];

export const MAX_SERVICE_SLOTS = 6;
/** Extra photos shown in the page's gallery section (on top of hero, about and the services). */
export const MAX_GALLERY_IMAGES = 6;
/** Upload files accepted when a page is created in the wizard. */
export const MAX_UPLOAD_IMAGES = 6;

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

export function applyImageSlot(current: ImageStore | null, slot: ParsedSlot, url: string): ImageStore {
  if (Array.isArray(current)) {
    const arr = current.map((x) => x ?? '');
    const i = slot.kind === 'hero' ? 0 : slot.kind === 'service' ? slot.index + ARRAY_SERVICE_OFFSET : slot.index + ARRAY_GALLERY_OFFSET;
    return padSet(arr, i, url);
  }
  const store: AiStore = {
    hero_image_url: current?.hero_image_url ?? null,
    icon_urls: [...(current?.icon_urls ?? [])],
    ...(current?.gallery_urls ? { gallery_urls: [...current.gallery_urls] } : {}),
  };
  if (slot.kind === 'hero') store.hero_image_url = url;
  else if (slot.kind === 'service') store.icon_urls = padSet(store.icon_urls, slot.index, url);
  else store.gallery_urls = padSet(store.gallery_urls ?? [], slot.index, url);
  return store;
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
  };
  if (slot.kind === 'service') {
    if (slot.index < store.icon_urls.length) store.icon_urls = padSet(store.icon_urls, slot.index, '');
  } else if (store.gallery_urls && slot.index < store.gallery_urls.length) {
    store.gallery_urls = trimTail(padSet(store.gallery_urls, slot.index, ''));
    if (!store.gallery_urls.length) delete store.gallery_urls;
  }
  return store;
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
 * Wizard uploads → array store: the first 3 photos fill the service cards (indexes 2-4, hero and
 * about stay empty), any further photos (up to MAX_UPLOAD_IMAGES in total) go to the gallery.
 */
export function packUploads(urls: string[]): string[] {
  const clean = urls.filter(Boolean).slice(0, MAX_UPLOAD_IMAGES);
  const out: string[] = ['', '', ...clean.slice(0, 3)];
  const rest = clean.slice(3);
  if (rest.length) {
    while (out.length < ARRAY_GALLERY_OFFSET) out.push('');
    out.push(...rest);
  }
  return out;
}

export const GALLERY_ARRAY_OFFSET = ARRAY_GALLERY_OFFSET;
