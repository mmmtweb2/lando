// The V3 design derives its ink / accents from the AI palette: text must stay readable whatever was picked.
import { buildPalette, contrast, ensureContrast, mix } from '../client/src/pages/landingV3/color';

function ok(c: unknown, m: string) { if (!c) { console.error('FAIL:', m); process.exit(1); } }

const samples = ['#ffffff', '#f5f5f5', '#ffee00', '#e8b04a', '#00ccff', '#b4532a', '#2563eb', '#111111', '#7c3aed', '#fde68a', '#16a34a'];
for (const primary of samples) {
  for (const accent of samples) {
    const p = buildPalette(primary, accent, '#fbf4e8');
    ok(contrast(p.primaryInk, p.paper) >= 4.5, `primaryInk readable on paper (${primary})`);
    ok(contrast(p.accentInk, p.paper) >= 4.5, `accentInk readable on paper (${accent})`);
    ok(contrast(p.onAccent, p.accent) >= 3, `text on accent block readable (${accent})`);
    ok(contrast(p.ink, p.paper) >= 7, `body ink strong on paper (${primary})`);
    ok(contrast(p.bandAccent, p.ink) >= 3 || contrast('#ffffff', p.ink) < 3, `band numerals visible (${accent})`);
  }
}
ok(buildPalette('#2563eb', '#f59e0b', 'not-a-colour').paper === '#faf6ee', 'invalid tint falls back to cream paper');
ok(buildPalette('#2563eb', '#f59e0b', undefined).paper === '#faf6ee', 'missing tint falls back to cream paper');
ok(mix('#000000', '#ffffff', 0.5) === '#808080', 'mix halfway');
ok(ensureContrast('#ffee00', '#ffffff') !== '#ffee00', 'light yellow on white gets darkened');

// Phase 1: the same checks over a seeded sweep of 3000 palettes (any hue, any saturation, light to dark),
// plus the pairs the lead form, legal block and credit line use. rgba() tokens are composited on the paper.
function hsl(h: number, sat: number, l: number): string {
  const a = sat * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
let seed = 20261108;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const over = (fg: string, alpha: number, bg: string) => mix(bg, fg, alpha);   // fg at `alpha` on solid bg
let worst = 99;
for (let i = 0; i < 3000; i++) {
  const primary = hsl(rnd() * 360, 0.15 + rnd() * 0.85, 0.08 + rnd() * 0.84);
  const accent = hsl(rnd() * 360, 0.2 + rnd() * 0.8, 0.12 + rnd() * 0.8);
  const tint = rnd() < 0.3 ? undefined : hsl(rnd() * 360, rnd() * 0.5, 0.88 + rnd() * 0.1);
  const p = buildPalette(primary, accent, tint);
  const tag = `${primary} ${accent} ${tint}`;
  const mutedOnPaper = over(p.ink, 0.74, p.paper);     // placeholders, captions, field labels
  const legalText = over('#ffffff', 0.8, p.ink);       // legal block and footer body text
  const legalNote = over('#ffffff', 0.7, p.ink);
  const credit = over('#ffffff', 0.76, p.ink);
  const checks: [string, number, number][] = [
    ['muted on paper', contrast(mutedOnPaper, p.paper), 4.5],
    ['ink on paper', contrast(p.ink, p.paper), 7],
    ['primaryInk (focus ring, links) on paper', contrast(p.primaryInk, p.paper), 3],
    ['paper on ink (submit button)', contrast(p.paper, p.ink), 7],
    ['legal text on ink', contrast(legalText, p.ink), 4.5],
    ['legal note on ink', contrast(legalNote, p.ink), 4.5],
    ['credit line on ink', contrast(credit, p.ink), 4.5],
    ['white headings on ink', contrast('#ffffff', p.ink), 7],
    ['on-accent text on accent (sent tick)', contrast(p.onAccent, p.accent), 3],
  ];
  for (const [name, v, min] of checks) { worst = Math.min(worst, v / min); ok(v >= min, `${name} ${v.toFixed(2)} < ${min} for ${tag}`); }
}
console.log('v3 colour checks passed (sweep of 3000 palettes, tightest ratio vs. its minimum: ' + worst.toFixed(2) + 'x)');
