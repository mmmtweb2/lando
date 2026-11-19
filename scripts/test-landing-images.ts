// Landing-page photos (README part 140): slot packing with a hero, the layout decisions (opening image,
// gallery by count and orientation), focal point and crops, alt text, the quality / logo hints, srcset.
// The sharp parts run on synthetic photos (scripts/_landing-image-fixtures.ts) with a fake uploader and no
// network: no DB, no storage, no key.
import sharp from 'sharp';
import { makePhoto, makeLogo } from './_landing-image-fixtures';
import {
  applyImageSlot, clearImageSlot, galleryOf, keepOwnerExtras, packUploads, packUploadStore, parseSlot,
  promoteLegacyHero, toObjectStore, pruneMeta, type ImageStore, type ImgMeta, type AiStore,
} from '../src/services/imageSlots';
import {
  analyzePhoto, assessQuality, blockSharpness, colorStats, computeFocal, fallbackAlt, isBlurry, isSmall, looksLikeLogo,
  pickHeroIndex, portraitCropSize, processPhoto, processUploadedPhotos, sanitizeAlt, toPercent, QUALITY, WARNING_TEXT,
  type PhotoAnalysis,
} from '../src/services/landingImages';
import { generatePhotoAlt } from '../src/services/imageAlt';
import * as client from '../client/src/lib/landingImages';

function ok(c: unknown, m: string) { if (!c) { console.error('FAIL:', m); process.exit(1); } }
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const A = (w: number, h: number, extra: Partial<PhotoAnalysis> = {}): PhotoAnalysis =>
  ({ width: w, height: h, sharpness: 400, transparentRatio: 0, dominantRatio: 0.1, significantColors: 20, ...extra });

// Simulates CSS grid "sparse" auto-placement: items in order, each takes the first free spot after the cursor.
// Returns the number of empty cells inside the rows the grid ends up with (0 = no gap anywhere).
function gapsAfterPlacing(spans: Array<{ c: number; r: number }>, cols: number): number {
  const occ: boolean[][] = [];
  const free = (r: number, c: number, sr: number, sc: number) => {
    if (c + sc > cols) return false;
    for (let y = r; y < r + sr; y++) for (let x = c; x < c + sc; x++) if (occ[y]?.[x]) return false;
    return true;
  };
  let row = 0;
  let col = 0;
  for (const s of spans) {
    for (;;) {
      if (free(row, col, s.r, s.c)) break;
      col++;
      if (col >= cols) { col = 0; row++; }
    }
    for (let y = row; y < row + s.r; y++) { occ[y] ??= Array(cols).fill(false); for (let x = col; x < col + s.c; x++) occ[y][x] = true; }
    col += s.c;
    if (col >= cols) { col = 0; row++; }
  }
  let gaps = 0;
  occ.forEach((r) => { for (let x = 0; x < cols; x++) if (!r?.[x]) gaps++; });
  return gaps;
}

(async () => {
  // ── slot packing with a hero, converting, pruning ──────────────────────────────
  const meta = (n: string): ImgMeta => ({ alt: `alt ${n}`, w: 1200, h: 800, sm: `${n}-s`, smw: 640, fx: 30, fy: 40 });
  const store = packUploadStore([{ url: 'a', meta: meta('a') }, { url: 'b', meta: meta('b') }, { url: 'c', meta: meta('c') }], 1);
  eq(store.hero_image_url, 'b', 'chosen upload is the hero');
  eq(store.gallery_urls, ['a', 'c'], 'others keep their order in the gallery');
  eq(Object.keys(store.img_meta ?? {}).sort(), ['a', 'b', 'c'], 'meta for every photo');
  eq(packUploadStore([]), { hero_image_url: null, icon_urls: [] }, 'no uploads, empty store');
  ok(packUploadStore(Array.from({ length: 12 }, (_, i) => ({ url: `u${i}`, meta: {} }))).gallery_urls!.length === 7, 'wizard cap: hero + 7');

  // legacy array pages: no hero, photos in the service cards
  eq(promoteLegacyHero(['', '', 'p1', 'p2', 'p3']).slice(0, 5), ['p1', '', 'p2', 'p3', ''], 'first service photo becomes the hero, the others shift left');
  eq(promoteLegacyHero(['h', '', 'p1']), ['h', '', 'p1'], 'an array with a hero is untouched');
  eq(promoteLegacyHero(['', 'about']), ['', 'about'], 'nothing to promote');
  eq(client.promoteLegacyHero(['', '', 'p1', 'p2', 'p3', '', '', '', 'g0']), promoteLegacyHero(['', '', 'p1', 'p2', 'p3', '', '', '', 'g0']), 'client and server promote the same way');
  const legacy: ImageStore = ['', 'about', 'p1', 'p2', 'p3', '', '', '', 'g0', 'g1'];
  const conv = toObjectStore(legacy, true);
  eq([conv.hero_image_url, conv.about_image_url, conv.icon_urls, conv.gallery_urls], ['p1', 'about', ['p2', 'p3'], ['g0', 'g1']], 'array -> object keeps every photo');
  eq(toObjectStore(legacy, false).hero_image_url, null, 'no promotion for stock pages');
  eq(toObjectStore(null), { hero_image_url: null, icon_urls: [] }, 'null store');

  // an upload into an old array page converts it, keeps the rest and carries meta
  const edited = applyImageSlot(legacy, { kind: 'gallery', index: 2 }, 'new', meta('new'), true) as AiStore;
  ok(!Array.isArray(edited), 'a photo with meta turns the page into the object shape');
  eq(galleryOf(edited), ['g0', 'g1', 'new'], 'gallery after converting');
  eq(edited.hero_image_url, 'p1', 'promoted hero persisted');
  eq(Object.keys(edited.img_meta ?? {}), ['new'], 'meta only for the new photo');
  // without meta the shape is kept (stock / AI callers)
  ok(Array.isArray(applyImageSlot(legacy, { kind: 'gallery', index: 2 }, 'x')), 'no meta: array stays an array');
  // replacing a photo drops the old photo's meta
  const replaced = applyImageSlot(edited, { kind: 'gallery', index: 2 }, 'newer', meta('newer')) as AiStore;
  eq(Object.keys(replaced.img_meta ?? {}), ['newer'], 'replaced photo meta is pruned');
  const hero2 = applyImageSlot(store, { kind: 'hero' }, 'h2', meta('h2')) as AiStore;
  eq([hero2.hero_image_url, Object.keys(hero2.img_meta ?? {}).sort()], ['h2', ['a', 'c', 'h2']], 'new hero replaces old, old meta pruned');
  const cleared = clearImageSlot(store, { kind: 'gallery', index: 0 }) as AiStore;
  eq([galleryOf(cleared), Object.keys(cleared.img_meta ?? {}).sort()], [['', 'c'], ['b', 'c']], 'removing a photo prunes its meta');
  eq(pruneMeta({ hero_image_url: 'x', icon_urls: [], img_meta: { y: {} } }), { hero_image_url: 'x', icon_urls: [] }, 'empty meta removed');
  const aiNext = keepOwnerExtras(edited, { hero_image_url: 'ai-hero', icon_urls: ['i0'] });
  eq([aiNext.hero_image_url, aiNext.gallery_urls, aiNext.about_image_url, Object.keys(aiNext.img_meta ?? {})], ['ai-hero', ['g0', 'g1', 'new'], 'about' === aiNext.about_image_url ? 'about' : undefined, ['new']], 'a regenerated AI set keeps gallery and meta');
  eq(parseSlot('gallery_11'), { kind: 'gallery', index: 11 }, 'gallery slots up to 12');

  // ── hero choice ────────────────────────────────────────────────────────────────
  eq(pickHeroIndex([]), 0, 'no photos');
  eq(pickHeroIndex([A(2400, 1600), A(2400, 1600)]), 0, 'equal photos: the first one');
  eq(pickHeroIndex([A(1500, 2000), A(2400, 1600)]), 1, 'a landscape photo beats a portrait first one');
  eq(pickHeroIndex([A(2400, 1600), A(1500, 2000)]), 0, 'a landscape first photo stays');
  eq(pickHeroIndex([A(500, 500), A(3000, 2000)]), 1, 'high resolution beats a small first photo');
  eq(pickHeroIndex([A(1200, 1200, { transparentRatio: 0.6 }), A(1600, 1000)].map((x) => ({ ...x, logo: looksLikeLogo(x) }))), 1, 'a logo-looking file is never chosen over a photo');
  eq(pickHeroIndex([{ ...A(500, 500, { transparentRatio: 0.6 }), logo: true }]), 0, 'a lone logo-looking file still has to go somewhere');
  eq(pickHeroIndex([A(2400, 1600, { sharpness: 5 }), A(1800, 1200)]), 1, 'a blurry first photo loses to a sharp one');

  // ── layout: the opening image ──────────────────────────────────────────────────
  eq(client.planHero({ w: 1600, h: 1067 }), 'cover', 'landscape hero covers the top');
  eq(client.planHero({ w: 1200, h: 1600 }), 'split', 'portrait hero is split on wide screens');
  eq(client.planHero({ w: 1000, h: 1000 }), 'split', 'square hero is split on wide screens');
  eq(client.planHero(undefined), 'cover', 'unknown size (old pages) covers');

  // ── layout: gallery by count and orientation ──────────────────────────────────
  const LAND = 1.5;
  const PORT = 0.75;
  eq(client.planGallery([]).kind, 'none', '0 photos: no gallery');
  const one = client.planGallery([LAND]);
  eq([one.kind, one.box, one.tiles.length], ['single', 'landscape', 1], '1 photo: one box');
  eq(client.planGallery([PORT]).box, 'portrait', '1 portrait photo: portrait box');
  eq(client.planGallery([1.0]).box, 'square', '1 square photo: square box');
  eq([client.planGallery([LAND, LAND]).kind, client.planGallery([LAND, LAND]).box], ['pair', 'landscape'], '2 landscape photos: a landscape pair');
  eq(client.planGallery([LAND, PORT]).box, 'portrait', '2 mixed photos: portrait boxes, nothing stretched');
  const patterns: number[][] = [];
  for (let n = 1; n <= 12; n++) {
    patterns.push(Array(n).fill(LAND), Array(n).fill(PORT), Array.from({ length: n }, (_, i) => (i % 2 ? PORT : LAND)), Array.from({ length: n }, (_, i) => (i % 3 === 0 ? PORT : LAND)), Array.from({ length: n }, (_, i) => (i % 2 ? LAND : PORT)));
  }
  ok(gapsAfterPlacing([{ c: 1, r: 1 }], 2) === 1 && gapsAfterPlacing([{ c: 1, r: 2 }, { c: 1, r: 1 }], 2) === 1, 'the gap simulator does see gaps');
  for (const asp of patterns) {
    const n = asp.length;
    const plan = client.planGallery(asp);
    ok(plan.tiles.length === n, `n=${n}: one tile per photo`);
    ok(plan.tiles.every((t, i) => t.index === i), `n=${n}: tiles in photo order`);
    if (plan.kind === 'grid') {
      const m = plan.tiles.map((t) => t.m);
      const d = plan.tiles.map((t) => t.d);
      ok(client.cellsOf(m) % 2 === 0 && client.cellsOf(d) % 3 === 0, `n=${n}: whole rows on phone and desktop`);
      ok(gapsAfterPlacing(m, 2) === 0, `n=${n} ${JSON.stringify(asp)}: no gap on a phone`);
      ok(gapsAfterPlacing(d, 3) === 0, `n=${n} ${JSON.stringify(asp)}: no gap on a desktop`);
      ok(m.every((s) => s.c <= 2) && d.every((s) => s.c <= 3), `n=${n}: no tile wider than the grid`);
    }
  }
  // a portrait photo that starts a band gets a tall cell
  ok(client.planGallery([PORT, LAND, LAND, LAND]).tiles[0].m.r === 2, 'portrait first photo: tall cell on a phone');
  ok(client.planGallery([LAND, LAND, LAND, LAND, LAND, LAND, LAND]).tiles[0].d.c === 2, 'landscape first photo of 7: a big landscape cell on a desktop');

  // ── srcset, alt, focal point ──────────────────────────────────────────────────
  const m1: ImgMeta = { alt: 'חתול על כיסא', w: 1200, h: 800, sm: 'https://x/s.webp', smw: 640, fx: 30.4, fy: 61 };
  eq(client.buildSrcSet('https://x/m.webp', m1), 'https://x/s.webp 640w, https://x/m.webp 1200w', 'srcset: small + main');
  eq(client.buildSrcSet('u', undefined), undefined, 'no meta: no srcset (old photos keep working as one file)');
  eq(client.buildSrcSet('u', { ...m1, smw: 1200 }), undefined, 'a "small" copy that is not smaller is ignored');
  eq(client.altFor(m1, 'דני'), 'חתול על כיסא', 'stored alt wins');
  eq(client.altFor(undefined, 'דני'), 'תמונה מהעבודה של דני', 'no alt: contextual sentence');
  eq(client.altFor(undefined, 'דני', true), '', 'AI pictures are decorative: alt=""');
  eq(client.focalPosition(m1), '30% 61%', 'focal point as object-position');
  eq(client.focalPosition({ ...m1, logo: true }), undefined, 'a logo is never positioned (contained)');
  eq(client.focalPosition(undefined), undefined, 'no focal point: browser default');
  eq(client.intrinsicSize(m1), { width: 1200, height: 800 }, 'width/height for the reserved space');
  eq(client.intrinsicSize(undefined), {}, 'old photos: no attributes');
  eq(client.aspectOf(m1), 1.5, 'aspect');
  eq(client.aspectOf(undefined), 1.5, 'unknown photos count as landscape');
  eq(Object.keys(client.readImgMeta({ hero_image_url: 'a', icon_urls: [], img_meta: { a: { alt: 'x', w: 10, h: 5, junk: 1 }, b: 'nope' } })), ['a'], 'readImgMeta drops malformed entries');
  eq(client.readImgMeta(['a', 'b']), {}, 'array pages have no meta');
  eq(client.isLowRes(799, 4000), true, 'short side under 800 is low-res');
  eq(client.isLowRes(800, 800), false, '800 is fine');
  eq(client.fallbackAlt('  דני   ושות '), fallbackAlt('  דני   ושות '), 'client and server fallback alt agree');

  // ── alt text ──────────────────────────────────────────────────────────────────
  eq(fallbackAlt('מספרת דני'), 'תמונה מהעבודה של מספרת דני', 'fallback alt names the business');
  eq(fallbackAlt('  '), 'תמונה מהעבודה שלנו', 'fallback alt without a name');
  eq(sanitizeAlt('"תספורת גבר בכיסא מספרה."', 'F'), 'תספורת גבר בכיסא מספרה', 'quotes and final dot removed');
  eq(sanitizeAlt('אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע עשר אחד-עשר שנים-עשר שלושה-עשר ארבעה-עשר', 'F').split(' ').length, 12, 'at most 12 words');
  eq(sanitizeAlt('a haircut in a chair', 'F'), 'F', 'not Hebrew: fallback');
  eq(sanitizeAlt('', 'F'), 'F', 'empty: fallback');
  eq(sanitizeAlt(undefined, 'F'), 'F', 'non-string: fallback');
  const jpeg = await makePhoto({ w: 300, h: 200, seed: 1 });
  eq(await generatePhotoAlt(jpeg, { businessName: 'דני' }, { client: null }), 'תמונה מהעבודה של דני', 'no key: fallback alt');
  const okClient = { messages: { create: async () => ({ content: [{ type: 'text', text: 'גבר יושב בכיסא מספרה' }] }) } };
  eq(await generatePhotoAlt(jpeg, { businessName: 'דני' }, { client: okClient as never }), 'גבר יושב בכיסא מספרה', 'model answer used');
  const failClient = { messages: { create: async () => { throw new Error('boom'); } } };
  eq(await generatePhotoAlt(jpeg, { businessName: 'דני' }, { client: failClient as never }), 'תמונה מהעבודה של דני', 'failed call: fallback, no throw');
  const slowClient = { messages: { create: () => new Promise(() => undefined) } };
  eq(await generatePhotoAlt(jpeg, { businessName: 'דני' }, { client: slowClient as never, timeoutMs: 30 }), 'תמונה מהעבודה של דני', 'slow call: fallback after the timeout');

  // ── quality rules ─────────────────────────────────────────────────────────────
  ok(isSmall(A(799, 1600), 'hero') && !isSmall(A(800, 800), 'hero'), 'hero: short side under 800 is small');
  ok(isSmall(A(499, 900), 'photo') && !isSmall(A(700, 700), 'photo'), 'photo: short side under 500 is small');
  ok(isSmall(A(2000, 140), 'photo'), 'a strip is small');
  ok(isBlurry(A(1000, 1000, { sharpness: QUALITY.blurMin - 1 })) && !isBlurry(A(1000, 1000, { sharpness: null })), 'unmeasurable is never blurry');
  eq(assessQuality(A(3000, 2000), 'hero'), null, 'a good photo: no hint');
  eq(assessQuality(A(720, 540), 'hero'), 'small', 'small hero');
  eq(assessQuality(A(720, 540), 'photo'), null, 'the same photo as a gallery photo is fine');
  eq(assessQuality(A(3000, 2000, { sharpness: 4 }), 'photo'), 'blurry', 'blurry');
  eq(assessQuality(A(400, 400, { transparentRatio: 0.7 }), 'photo'), 'logo', 'logo-looking comes first');
  ok(looksLikeLogo(A(400, 400, { dominantRatio: 0.7, significantColors: 3 })), 'flat colours, small: logo');
  ok(!looksLikeLogo(A(3000, 3000, { dominantRatio: 0.7, significantColors: 3 })), 'flat but huge: not a logo');
  ok(!looksLikeLogo(A(1200, 800, { dominantRatio: 0.2, significantColors: 30 })), 'a photo is not a logo');
  ok(!looksLikeLogo(A(3000, 200, { transparentRatio: 0.9 })), 'a very wide strip is not a logo');
  ok(Object.values(WARNING_TEXT).every((t) => /אפשר להמשיך/.test(t)), 'every hint says the customer can continue');
  eq(colorStats(new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255]), 4).transparentRatio, 0.25, 'colorStats transparent share');
  eq(portraitCropSize(2400, 1600), { w: 800, h: 1200 }, 'portrait crop of a big landscape photo');
  eq(portraitCropSize(400, 300), { w: 200, h: 300 }, 'portrait crop is never enlarged');
  eq(portraitCropSize(1500, 2000).w <= 800 && portraitCropSize(1500, 2000).h <= 1200, true, 'portrait crop of a portrait photo fits');
  eq([toPercent(0.304), toPercent(-1), toPercent(7), toPercent(NaN)], [30, 0, 100, 50], 'toPercent clamps');

  // ── sharp on synthetic photos ─────────────────────────────────────────────────
  const sharpPhoto = await makePhoto({ w: 2400, h: 1600, seed: 3 });
  const softPhoto = await makePhoto({ w: 2400, h: 1600, seed: 3, blur: 6 });
  const aSharp = await analyzePhoto(sharpPhoto);
  const aSoft = await analyzePhoto(softPhoto);
  eq([aSharp.width, aSharp.height], [2400, 1600], 'analysis size');
  ok(aSharp.sharpness! > QUALITY.blurMin * 3, `a sharp photo measures sharp (${aSharp.sharpness})`);
  ok(isBlurry(aSoft), `a heavily blurred photo is blurry (${aSoft.sharpness})`);
  ok(!isBlurry(aSharp) && !looksLikeLogo(aSharp), 'a sharp photo is neither blurry nor a logo');
  ok(blockSharpness(new Uint8Array(10 * 10), 10, 10) === null, 'too small to measure');
  const aLogo = await analyzePhoto(await makeLogo(400, true));
  const aLogoFlat = await analyzePhoto(await makeLogo(400, false));
  ok(looksLikeLogo(aLogo) && looksLikeLogo(aLogoFlat), 'transparent and flat logo files are recognised');
  // EXIF-rotated phone photo: analysis uses the displayed orientation
  const rotated = await sharp(await makePhoto({ w: 1600, h: 1000, seed: 2 })).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const aRot = await analyzePhoto(rotated);
  eq([aRot.width, aRot.height], [1000, 1600], 'EXIF orientation is applied to the size');

  // focal point follows the subject
  for (const [sx, sy] of [[0.2, 0.3], [0.8, 0.7], [0.25, 0.75]]) {
    const f = await computeFocal(await makePhoto({ w: 1600, h: 1000, seed: 11, sx, sy }));
    ok(Math.abs(f.fx - sx * 100) <= 12 && Math.abs(f.fy - sy * 100) <= 12, `focal point near the subject (${sx},${sy}) -> ${JSON.stringify(f)}`);
  }

  // ── processPhoto / processUploadedPhotos with a fake uploader ─────────────────
  const stored = new Map<string, Buffer>();
  const upload = async (data: Buffer, name: string) => { stored.set(name, data); return `https://cdn.test/${name}`; };
  const makeAlt = async () => 'תספורת גבר בכיסא';
  const heroPhoto = await makePhoto({ w: 2400, h: 1600, seed: 5, sx: 0.3, sy: 0.4 });
  const p = await processPhoto(heroPhoto, { role: 'hero', businessName: 'דני', upload, makeAlt });
  eq([p.meta.w, p.meta.h], [1600, 1067], 'hero main copy is 1600 wide');
  ok(p.meta.sm && p.meta.smw === 640, 'a 640px copy exists');
  ok(p.meta.pm && p.meta.pw === 800 && p.meta.ph === 1200, 'the hero has a portrait crop for phones');
  eq(p.meta.alt, 'תספורת גבר בכיסא', 'alt stored');
  ok(Math.abs(p.meta.fx! - 30) <= 12 && Math.abs(p.meta.fy! - 40) <= 12, 'focal point stored');
  eq(p.warning, null, 'no hint for a good photo');
  const pmInfo = await sharp(stored.get(p.meta.pm!.split('/').pop()!)!).metadata();
  eq([pmInfo.width, pmInfo.height, pmInfo.format], [800, 1200, 'webp'], 'portrait crop is a real 800x1200 WebP');
  const smInfo = await sharp(stored.get(p.meta.sm!.split('/').pop()!)!).metadata();
  eq(smInfo.width, 640, 'small copy is 640 wide');
  ok(stored.get(p.meta.sm!.split('/').pop()!)!.length < stored.get(p.url.split('/').pop()!)!.length, 'the small copy is lighter than the main copy');
  const gallery1 = await processPhoto(heroPhoto, { role: 'photo', businessName: 'דני', upload, makeAlt });
  eq([gallery1.meta.w, gallery1.meta.pm], [1200, undefined], 'a gallery photo is 1200 wide with no portrait crop');
  const tiny = await processPhoto(await makePhoto({ w: 420, h: 300, seed: 6 }), { role: 'photo', businessName: 'דני', upload, makeAlt });
  eq([tiny.warning?.code, tiny.meta.sm], ['small', undefined], 'a tiny photo is accepted with a hint and has no pointless small copy');
  const blurry = await processPhoto(softPhoto, { role: 'photo', businessName: 'דני', upload, makeAlt });
  eq(blurry.warning?.code, 'blurry', 'a blurry photo is accepted with a hint');
  ok(typeof blurry.url === 'string', 'blurry photo still stored (never blocked)');
  const logo = await processPhoto(await makeLogo(400, true), { role: 'hero', businessName: 'דני', upload, makeAlt });
  eq([logo.warning?.code, logo.meta.logo, logo.meta.pm], ['logo', true, undefined], 'a logo-looking file: hint, flagged, no hero crop');
  const failingAlt = async () => { throw new Error('no key'); };
  eq((await processPhoto(heroPhoto, { role: 'photo', businessName: 'דני', upload, makeAlt: failingAlt })).meta.alt, 'תמונה מהעבודה של דני', 'alt failure falls back');
  let threw = false;
  try { await processPhoto(Buffer.from('not an image'), { role: 'photo', businessName: 'דני', upload, makeAlt }); } catch { threw = true; }
  ok(threw, 'an unreadable file is an error (the caller says so), not a silent drop');

  const batch = await processUploadedPhotos([
    { buffer: await makePhoto({ w: 1500, h: 2000, seed: 8 }), name: 'portrait.jpg' },
    { buffer: heroPhoto, name: 'landscape.jpg' },
    { buffer: await makeLogo(400, true), name: 'logo.png' },
    { buffer: await makePhoto({ w: 420, h: 300, seed: 6 }), name: 'tiny.jpg' },
  ], { businessName: 'דני', upload, makeAlt });
  const bs = batch.store;
  ok(bs.hero_image_url === batch.processed[1].url, 'the landscape photo became the hero, not the portrait first one');
  eq(bs.gallery_urls?.length, 3, 'the other three are in the gallery');
  ok(!!bs.img_meta && Object.keys(bs.img_meta).length === 4, 'meta for all four');
  eq(batch.warnings.map((w) => [w.index, w.code, w.fileName]), [[2, 'logo', 'logo.png'], [3, 'small', 'tiny.jpg']], 'hints say which file');
  const single = await processUploadedPhotos([{ buffer: heroPhoto, name: 'a.jpg' }], { businessName: 'דני', upload, makeAlt });
  eq([single.store.gallery_urls, single.warnings], [undefined, []], 'one photo: hero only, no gallery');

  console.log('landing image checks passed');
})().catch((e) => { console.error('FAIL (exception):', e); process.exit(1); });
