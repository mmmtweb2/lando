// ─────────────────────────────────────────────────────────────────────────────
// storage.service.ts — durable object storage for user-uploaded images.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// processAndSave() used to write uploaded logos and photos to
// `public/uploads/` — the CONTAINER'S OWN DISK. No persistent volume is
// declared anywhere in the Dockerfile or the Coolify config, so that directory
// is part of the container filesystem and is destroyed on every redeploy. Every
// customer logo and photo silently vanished at the next deploy, leaving broken
// <img> tags on live, paid landing pages. That is the bug this closes.
//
// Uploads now go to Supabase Storage, using the SAME service-role credentials
// the rest of the backend already uses (config/supabase.ts) — no new
// credentials, no new provider, no new env var beyond the optional bucket-name
// override.
//
// ── Existing files are NOT migrated, deliberately ────────────────────────────
// Moshe's explicit call: everything currently in public/uploads is test data,
// not real customers. So there is no backfill and no dual-read fallback. The
// old `/uploads/...` URLs already stored in landing_pages rows keep resolving
// for as long as the current container lives (app.ts still serves /public
// statically) and will 404 after the next redeploy — which is exactly what
// already happens today. Only NEW uploads are fixed.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../config/supabase';

/**
 * Bucket holding all user-uploaded page assets. Overridable so staging and
 * production can share one Supabase project without sharing files.
 */
export const ASSETS_BUCKET = process.env.SUPABASE_ASSETS_BUCKET || 'page-assets';

/** Folder prefix inside the bucket — keeps room for other asset kinds later. */
const UPLOAD_PREFIX = 'uploads';

/**
 * Bucket creation is attempted ONCE per process, lazily, on the first upload.
 *
 * Doing it here rather than requiring a dashboard click means a fresh Supabase
 * project (or a new staging project) works with no manual setup step — the
 * service-role key is allowed to create buckets. It is idempotent: if the
 * bucket already exists, createBucket returns a "already exists" error which is
 * treated as success.
 *
 * The promise is cached, not the result, so concurrent first uploads all await
 * the same attempt instead of racing to create the same bucket.
 */
let bucketReady: Promise<void> | null = null;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return bucketReady;

  bucketReady = (async () => {
    const { error } = await supabase.storage.createBucket(ASSETS_BUCKET, {
      // Public: these are landing-page images served directly to anonymous
      // visitors by <img src>. Signed URLs would expire and break live pages,
      // and there is nothing private here — every one of these images is
      // already displayed on a public page.
      public: true,
      // Matches the multer limit in upload.middleware.ts. Belt-and-braces: the
      // API rejects oversized uploads first, this stops anything that gets past.
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: ['image/webp', 'image/png', 'image/jpeg'],
    });

    if (error) {
      const message = error.message ?? '';
      // Already exists → nothing to do. Supabase phrases this differently across
      // versions, so match loosely rather than on an exact string.
      if (/exists/i.test(message)) return;

      // Anything else (no permission, wrong key, network) is logged but NOT
      // thrown: the bucket may well already exist and simply not be listable
      // with this key. Let the upload itself be the real test — a genuine
      // problem surfaces there with a far more useful error.
      console.warn(`[STORAGE] could not ensure bucket "${ASSETS_BUCKET}": ${message}`);
    }
  })();

  return bucketReady;
}

/**
 * Upload a processed image buffer and return its permanent public URL.
 *
 * Throws on failure — the caller (processAndSave) must not fall back to local
 * disk, because a silent fallback is exactly the failure mode this file exists
 * to remove: it would look like it worked and break at the next redeploy.
 */
export async function uploadImage(
  buffer: Buffer,
  filename: string,
  contentType = 'image/webp',
): Promise<string> {
  await ensureBucket();

  const objectPath = `${UPLOAD_PREFIX}/${filename}`;

  const { error } = await supabase.storage
    .from(ASSETS_BUCKET)
    .upload(objectPath, buffer, {
      contentType,
      // Filenames already carry a timestamp and a random suffix, so a collision
      // means something is wrong. Never overwrite: silently replacing another
      // page's image would be worse than a failed upload.
      upsert: false,
      // A year. These objects are immutable — a new upload always gets a new
      // filename — so they can be cached as aggressively as the CDN allows.
      cacheControl: '31536000',
    });

  if (error) {
    console.error('[STORAGE] upload failed:', error.message, { bucket: ASSETS_BUCKET, objectPath });
    throw new Error(`Image upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(objectPath);
  if (!data?.publicUrl) {
    throw new Error('Image upload succeeded but no public URL was returned');
  }

  return data.publicUrl;
}
