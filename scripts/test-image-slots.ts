// Unit checks for the image slot helpers (where each photo lives in landing_pages.user_images).
import {
  parseSlot, applyImageSlot, clearImageSlot, galleryOf, galleryCount, packUploads,
  MAX_GALLERY_IMAGES, GALLERY_ARRAY_OFFSET, type ImageStore,
} from '../src/services/imageSlots';

function ok(c: unknown, m: string) { if (!c) { console.error('FAIL:', m); process.exit(1); } }
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// parseSlot: valid + invalid + bounds
eq(parseSlot('hero'), { kind: 'hero' }, 'hero');
eq(parseSlot(' service_2 '), { kind: 'service', index: 2 }, 'service_2');
eq(parseSlot('gallery_5'), { kind: 'gallery', index: 5 }, 'gallery_5');
for (const bad of ['gallery_6', 'service_6', 'gallery_-1', 'gallery_', 'portfolio_1', '', 'hero2', 'gallery_001x', undefined, null]) {
  ok(parseSlot(bad as string) === null, `rejects ${String(bad)}`);
}

// array store: service and gallery never collide
const arr = ['', '', 'a', 'b', 'c'];
const a1 = applyImageSlot(arr, { kind: 'service', index: 5 }, 'S5') as string[];
const a2 = applyImageSlot(a1, { kind: 'gallery', index: 0 }, 'G0') as string[];
eq(a2[7], 'S5', 'service_5 at index 7');
eq(a2[GALLERY_ARRAY_OFFSET], 'G0', 'gallery_0 right after the service slots');
eq(galleryOf(a2), ['G0'], 'galleryOf array');
eq(arr, ['', '', 'a', 'b', 'c'], 'input not mutated');
const a3 = applyImageSlot(null, { kind: 'gallery', index: 2 }, 'G2') as string[];
eq(galleryOf(a3), ['', '', 'G2'], 'hole padded');
eq(galleryCount(a3), 1, 'galleryCount ignores holes');

// array clear: trims the tail, keeps middle holes
const cleared = clearImageSlot(applyImageSlot(a3, { kind: 'gallery', index: 0 }, 'G0'), { kind: 'gallery', index: 2 }) as string[];
eq(galleryOf(cleared), ['G0'], 'cleared tail trimmed');
eq(clearImageSlot(arr, { kind: 'hero' }), arr, 'hero cannot be cleared');
eq(clearImageSlot(arr, { kind: 'gallery', index: 3 }), arr, 'clearing beyond the end is a no-op');

// AI store
const ai: ImageStore = { hero_image_url: 'H', icon_urls: ['i0'] };
const b1 = applyImageSlot(ai, { kind: 'gallery', index: 1 }, 'G1') as { hero_image_url: string; icon_urls: string[]; gallery_urls: string[] };
eq(b1.gallery_urls, ['', 'G1'], 'ai gallery');
eq(b1.icon_urls, ['i0'], 'ai services untouched');
eq(ai, { hero_image_url: 'H', icon_urls: ['i0'] }, 'ai input not mutated');
const b2 = clearImageSlot(b1, { kind: 'gallery', index: 1 }) as { gallery_urls?: string[] };
ok(b2.gallery_urls === undefined, 'empty gallery removed from ai store');
const b3 = clearImageSlot(ai, { kind: 'service', index: 0 }) as { icon_urls: string[] };
eq(b3.icon_urls, [''], 'ai service cleared');
eq(galleryOf({ hero_image_url: null, icon_urls: [], gallery_urls: ['x'] }), ['x'], 'galleryOf ai');

// wizard uploads
eq(packUploads(['u0', 'u1']), ['', '', 'u0', 'u1'], 'two uploads');
eq(packUploads(['u0', 'u1', 'u2']), ['', '', 'u0', 'u1', 'u2'], 'three uploads');
const six = packUploads(['u0', 'u1', 'u2', 'u3', 'u4', 'u5']);
eq(galleryOf(six), ['u3', 'u4', 'u5'], 'extra uploads go to the gallery');
eq(six.slice(2, 5), ['u0', 'u1', 'u2'], 'first three stay services');
eq(packUploads(Array.from({ length: 9 }, (_, i) => `u${i}`)).length, GALLERY_ARRAY_OFFSET + 3, 'capped at 6 uploads');
ok(MAX_GALLERY_IMAGES === 6, 'gallery cap');
console.log('image slot checks passed');
