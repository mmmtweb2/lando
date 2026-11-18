// Synthetic "photos" for the landing-image tests and screenshots: gradients, soft shapes, film grain and
// a clearly salient subject at a known place. Nothing here is a real photograph; it only has to behave
// like one for sharp's crop strategy and the sharpness / logo estimates.
import sharp from 'sharp';

export interface FixtureOpts {
  w: number;
  h: number;
  seed?: number;
  /** Subject centre as a fraction of the image (default 0.5 / 0.5). */
  sx?: number;
  sy?: number;
  /** Subject kind: a warm disc with a face-like look, or a saturated product box. */
  subject?: 'face' | 'product';
  /** Palette hue base (0-360). */
  hue?: number;
  blur?: number;
  /** Add a label drawn into the picture (helps eyes tell the screenshots apart). */
  label?: string;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export async function makePhoto(o: FixtureOpts): Promise<Buffer> {
  const { w, h } = o;
  const r = rng(o.seed ?? 7);
  const hue = o.hue ?? Math.floor(r() * 360);
  const sx = (o.sx ?? 0.5) * w;
  const sy = (o.sy ?? 0.5) * h;
  const u = Math.min(w, h);
  const shapes: string[] = [];
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, s = (0.05 + r() * 0.22) * u;
    const hh = (hue + r() * 70 - 35 + 360) % 360;
    const l = 30 + r() * 40;
    shapes.push(r() > 0.5
      ? `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${s.toFixed(0)}" fill="hsl(${hh.toFixed(0)} 28% ${l.toFixed(0)}%)" opacity="0.55"/>`
      : `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${(s * 1.6).toFixed(0)}" height="${s.toFixed(0)}" rx="${(s * 0.15).toFixed(0)}" fill="hsl(${hh.toFixed(0)} 30% ${l.toFixed(0)}%)" opacity="0.5"/>`);
  }
  const R = 0.2 * u;
  const subject = (o.subject ?? 'face') === 'face'
    ? `<circle cx="${sx}" cy="${sy}" r="${R}" fill="#e8b48f"/>
       <path d="M${sx - R} ${sy - R * 0.1} Q${sx} ${sy - R * 1.5} ${sx + R} ${sy - R * 0.1} Q${sx} ${sy - R * 0.55} ${sx - R} ${sy - R * 0.1}Z" fill="#3b2a20"/>
       <circle cx="${sx - R * 0.35}" cy="${sy}" r="${R * 0.07}" fill="#222"/><circle cx="${sx + R * 0.35}" cy="${sy}" r="${R * 0.07}" fill="#222"/>
       <path d="M${sx - R * 0.35} ${sy + R * 0.4} Q${sx} ${sy + R * 0.65} ${sx + R * 0.35} ${sy + R * 0.4}" stroke="#a33" stroke-width="${R * 0.06}" fill="none"/>
       <rect x="${sx - R * 1.1}" y="${sy + R * 0.95}" width="${R * 2.2}" height="${R * 2.4}" rx="${R * 0.3}" fill="hsl(${(hue + 180) % 360} 70% 45%)"/>`
    : `<rect x="${sx - R * 1.2}" y="${sy - R}" width="${R * 2.4}" height="${R * 2}" rx="${R * 0.2}" fill="hsl(${(hue + 30) % 360} 90% 52%)"/>
       <rect x="${sx - R * 0.8}" y="${sy - R * 0.5}" width="${R * 1.6}" height="${R * 0.5}" fill="#fff" opacity="0.9"/>`;
  const label = o.label
    ? `<text x="${w * 0.04}" y="${h * 0.95}" font-family="DejaVu Sans, sans-serif" font-size="${Math.round(u * 0.05)}" fill="#ffffff" opacity="0.85">${o.label}</text>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 45% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 50% 28%)"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>${shapes.join('')}${subject}${label}</svg>`;

  const grain = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 26 } } }).png().toBuffer();
  let img = sharp(Buffer.from(svg)).composite([{ input: grain, blend: 'soft-light' }]);
  let jpeg = await img.jpeg({ quality: 90 }).toBuffer();
  if (o.blur) jpeg = await sharp(jpeg).blur(o.blur).jpeg({ quality: 90 }).toBuffer();
  return jpeg;
}

/** A flat, partly transparent logo-like PNG: a coloured circle with a letter on a transparent square. */
export async function makeLogo(size = 400, withAlpha = true): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${withAlpha ? '' : `<rect width="${size}" height="${size}" fill="#ffffff"/>`}
    <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.32}" fill="#1f6feb"/>
    <text x="${size / 2}" y="${size * 0.6}" font-family="DejaVu Sans, sans-serif" font-size="${size * 0.36}" font-weight="700" text-anchor="middle" fill="#ffffff">P</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
