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
console.log('v3 colour checks passed');
