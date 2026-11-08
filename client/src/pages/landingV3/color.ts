// Small colour helpers for the V3 ("Pinkas") design: derive an ink / paper / readable accents from
// the page's AI palette so text keeps its contrast whatever the AI picked.

type RGB = [number, number, number];

function parse(c: string): RGB {
  let h = (c || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [30, 41, 59];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex([r, g, b]: RGB): string {
  const x = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${x(r)}${x(g)}${x(b)}`;
}

/** t = 0 → a, t = 1 → b */
export function mix(a: string, b: string, t: number): string {
  const A = parse(a), B = parse(b);
  return toHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

function lum(c: string): number {
  const [r, g, b] = parse(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Moves `fg` toward black (on a light bg) or white (on a dark bg) until it reads at `min`:1. */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return fg;
  const target = lum(bg) > 0.4 ? '#000000' : '#ffffff';
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const c = mix(fg, target, t);
    if (contrast(c, bg) >= min) return c;
  }
  return target;
}

/** Text colour (ink or white) with the better contrast on `bg`. */
export function onColor(bg: string, ink = '#1b1b1b'): string {
  return contrast(bg, '#ffffff') >= contrast(bg, ink) ? '#ffffff' : ink;
}

export interface V3Palette {
  paper: string; ink: string; primary: string; primaryInk: string;
  accent: string; accentInk: string; onAccent: string; hi: string;
  bandAccent: string; rule: string; muted: string;
}

export function buildPalette(primary: string, accent: string, tint?: string): V3Palette {
  const paper = tint && /^#?[0-9a-fA-F]{3,6}$/.test(tint) ? mix(tint.startsWith('#') ? tint : `#${tint}`, '#ffffff', 0.4) : '#faf6ee';
  const ink = mix(primary, '#000000', 0.78);
  const accentInk = ensureContrast(accent, paper, 4.5);
  const rgba = (c: string, a: number) => {
    const [r, g, b] = parse(c);
    return `rgba(${r},${g},${b},${a})`;
  };
  return {
    paper, ink, primary,
    primaryInk: ensureContrast(primary, paper, 4.5),
    accent, accentInk,
    onAccent: onColor(accent, ink),
    hi: mix(accent, paper, 0.55),
    bandAccent: ensureContrast(accent, ink, 3),
    rule: rgba(ink, 0.22),
    muted: rgba(ink, 0.74),
  };
}
