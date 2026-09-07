import sharp from 'sharp';
import * as fal from '@fal-ai/serverless-client';
import { uploadImage } from './storage.service';

// Configure once at module load — FAL_KEY may be absent in dev, guarded at call site
fal.config({ credentials: process.env.FAL_KEY });

interface FalImage { url: string; width: number; height: number }
interface FalResult { images: FalImage[] }

/**
 * Generate a single targeted image via Fal.ai flux/dev.
 *
 * Deliberately upgraded from the fast/distilled `flux/schnell` tier to the
 * standard `flux/dev` tier (CEO decision, checked fal.ai's pricing first) —
 * dev produces noticeably higher-fidelity hero/icon images. Per-image cost
 * is roughly ~8x schnell's, which is economically negligible against
 * Pagey's per-page price point. `num_inference_steps` was bumped from
 * schnell's minimal 4 (schnell is a distilled few-step model; 4 is already
 * near its ceiling) to 28 — fal.ai's commonly-used default for flux/dev's
 * quality/speed balance. Leaving it at 4 would pay dev's higher price while
 * wasting the quality dev is actually capable of.
 * @param prompt  Detailed English Flux prompt (hero photography or 3D icon).
 * @param size    'landscape_4_3' for hero images, 'square_hd' for service icons.
 */
export async function generateFalImage(
  prompt: string,
  size: 'landscape_4_3' | 'square_hd' = 'landscape_4_3',
): Promise<string> {
  console.log(`[FAL] generateFalImage — size:${size} — FAL_KEY present:${!!process.env.FAL_KEY}`);
  console.log('[FAL] Prompt:', prompt.slice(0, 120));
  if (!process.env.FAL_KEY) throw new Error('FAL_KEY is not configured');

  let result: FalResult;
  try {
    result = await fal.subscribe('fal-ai/flux/dev', {
      input: {
        prompt,
        image_size: size,
        num_images: 1,
        num_inference_steps: 28,
      },
    }) as FalResult;
  } catch (err) {
    const detail = (err as { body?: { detail?: unknown } })?.body?.detail;
    console.error('[FAL] fal.subscribe threw:', JSON.stringify(detail ?? err, null, 2));
    throw err;
  }

  const url = result?.images?.[0]?.url;
  if (!url) throw new Error('Fal.ai returned no image URL');
  console.log('[FAL] Generated:', url.slice(0, 90));
  return url;
}

/**
 * generateFalImage() + download + re-encode to compressed WebP, stored in our
 * own Supabase Storage — same optimization pipeline processAndSave() already
 * applies to user-uploaded photos.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Every AI-image call site used to store fal.ai's raw returned URL directly
 * (an unoptimized PNG/JPEG on fal's own CDN, often 1-3 MB at flux/dev's
 * quality). Reported as "pages load very slowly, especially images" — this
 * was the real root cause: uploaded photos were always compressed via
 * processAndSave(), but AI-generated hero/service images never were, and got
 * larger still after the flux/schnell -> flux/dev upgrade (bigger, higher-
 * fidelity source images). Downloading and re-encoding here brings AI images
 * to WebP quality 80 at a bounded max width, matching what uploaded photos
 * already get, and moves the asset into our own storage instead of leaving
 * production pages permanently dependent on fal.ai's CDN staying up.
 *
 * @param maxWidth  1600 for hero (full-bleed), 800 for service/icon images —
 *                  callers pass the right one for where the image renders.
 */
export async function generateAndOptimizeFalImage(
  prompt: string,
  size: 'landscape_4_3' | 'square_hd',
  maxWidth: number,
  prefix: string,
): Promise<string> {
  const falUrl = await generateFalImage(prompt, size);
  const res = await fetch(falUrl);
  if (!res.ok) throw new Error(`Failed to download generated image from fal.ai (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return processAndSave(buffer, maxWidth, prefix);
}

/**
 * Resize + re-encode an uploaded image to WebP and store it durably.
 *
 * Returns an ABSOLUTE Supabase Storage URL, where this used to return a
 * site-relative `/uploads/...` path.
 *
 * ── Why the change ───────────────────────────────────────────────────────────
 * This function wrote to `public/uploads/` — the container's own disk, with no
 * persistent volume declared anywhere in the Dockerfile or Coolify config. That
 * directory is destroyed on every redeploy, so every customer logo and photo
 * silently disappeared at the next deploy and live, paid landing pages were
 * left with broken images. Uploads now go to Supabase Storage (see
 * storage.service.ts), on the same service-role credentials the rest of the
 * backend already uses.
 *
 * ── Why the changed return value is safe ─────────────────────────────────────
 * Every consumer already treats these values as opaque strings handed straight
 * to an <img src> or stored in landing_pages.logo_url / user_images: the
 * wizard, the inline image editor, the OG-tag builder. An absolute URL works in
 * all of them, and AI-generated images (generateFalImage above) have always
 * returned absolute third-party URLs through the same fields — so absolute URLs
 * in these columns are the pre-existing normal case, not a new one.
 *
 * Existing `/uploads/...` values in the database are NOT migrated (Moshe's
 * call: current uploads are test data). app.ts still serves /public statically,
 * so they resolve exactly as well — and as badly — as they do today.
 *
 * Throws if the upload fails. Deliberately no fall back to local disk: a silent
 * fallback would look like success and break at the next redeploy, which is the
 * precise bug being removed here.
 */
export async function processAndSave(buffer: Buffer, maxWidth: number, prefix = 'file'): Promise<string> {
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}.webp`;

  // Re-encode in memory rather than via .toFile() — there is no longer a local
  // path to write to, and the buffer goes straight to object storage.
  //
  // .rotate() with no arguments auto-orients the pixels using the source
  // file's EXIF Orientation tag, then clears that tag. Without this, sharp
  // leaves the raw sensor-orientation pixels untouched AND strips EXIF on
  // WebP output (the default) — so a portrait phone photo (sensor data
  // landscape + an EXIF tag saying "rotate 90°") went in looking correct
  // and came out sideways, with no metadata left for the browser to correct
  // it with. This was a real reported bug (photos uploaded to a landing
  // page rendering sideways). Must run BEFORE resize — rotating after
  // resizing a non-square image swaps width/height and can crop wrong.
  const webp = await sharp(buffer)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const url = await uploadImage(webp, filename, 'image/webp');
  console.log('[IMAGE] stored', { filename, bytes: webp.length });
  return url;
}
