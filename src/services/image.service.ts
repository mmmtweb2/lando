import sharp from 'sharp';
import * as fal from '@fal-ai/serverless-client';
import { uploadImage } from './storage.service';

// Configure once at module load — FAL_KEY may be absent in dev, guarded at call site
fal.config({ credentials: process.env.FAL_KEY });

interface FalImage { url: string; width: number; height: number }
interface FalResult { images: FalImage[] }

/**
 * Generate a single targeted image via Fal.ai flux/schnell.
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
    result = await fal.subscribe('fal-ai/flux/schnell', {
      input: {
        prompt,
        image_size: size,
        num_images: 1,
        num_inference_steps: 4,
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
  const webp = await sharp(buffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const url = await uploadImage(webp, filename, 'image/webp');
  console.log('[IMAGE] stored', { filename, bytes: webp.length });
  return url;
}
