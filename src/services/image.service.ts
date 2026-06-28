import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import * as fal from '@fal-ai/serverless-client';

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

export async function processAndSave(buffer: Buffer, maxWidth: number, prefix = 'file'): Promise<string> {
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}.webp`;
  await sharp(buffer)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(uploadsDir, filename));
  return `/uploads/${filename}`;
}
