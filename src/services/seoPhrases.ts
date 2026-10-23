// Stage 8.1 — service areas and long-tail phrases. Pure, no I/O.
//
// Phrases are built from templates over what the CUSTOMER typed (business type + areas), not
// from Places data and not from an LLM: they are predictable, free, and cannot invent anything.

export const MAX_AREAS = 5;
export const MAX_PHRASES = 5;

// Hebrew, Latin, digits, space and a few joiners. No newlines/markup: these strings end up in
// prompts, URLs and HTML, so we keep the alphabet tight instead of escaping case by case.
const SAFE = /^[֐-׿A-Za-z0-9 '"\-.,()/]+$/;

export function cleanLabel(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string') return null;
  // Newlines/tabs/control characters are rejected outright rather than silently flattened.
  if (/[\u0000-\u001F]/.test(v)) return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max || !SAFE.test(s)) return null;
  return s;
}

export interface PlanSettings {
  businessType: string;
  serviceAreas: string[];
  phrases: string[];
  facts: string;
}

export type SettingsResult = { ok: true; value: PlanSettings } | { ok: false; error: string };

export const MAX_FACTS = 1500;

export function validateSettings(input: unknown): SettingsResult {
  const b = (input ?? {}) as Record<string, unknown>;
  const businessType = cleanLabel(b.businessType, 2, 40);
  if (!businessType) return { ok: false, error: 'תחום העסק לא תקין (2–40 תווים, אותיות ומספרים בלבד).' };

  const rawAreas = Array.isArray(b.serviceAreas) ? b.serviceAreas : [];
  const serviceAreas: string[] = [];
  for (const a of rawAreas) {
    const c = cleanLabel(a, 2, 30);
    if (!c) return { ok: false, error: 'אחד מאזורי השירות לא תקין.' };
    if (!serviceAreas.includes(c)) serviceAreas.push(c);
  }
  if (serviceAreas.length === 0) return { ok: false, error: 'צריך לפחות אזור שירות אחד.' };
  if (serviceAreas.length > MAX_AREAS) return { ok: false, error: `עד ${MAX_AREAS} אזורי שירות.` };

  const rawPhrases = Array.isArray(b.phrases) ? b.phrases : [];
  const phrases: string[] = [];
  for (const p of rawPhrases) {
    const c = cleanLabel(p, 3, 80);
    if (!c) return { ok: false, error: 'אחד הביטויים לא תקין.' };
    if (!phrases.includes(c)) phrases.push(c);
  }
  if (phrases.length > MAX_PHRASES) return { ok: false, error: `עד ${MAX_PHRASES} ביטויים.` };

  const facts = typeof b.facts === 'string' ? b.facts.replace(/\r\n/g, '\n').trim() : '';
  if (facts.length > MAX_FACTS) return { ok: false, error: `עד ${MAX_FACTS} תווים בתיאור העסק.` };
  // Control characters have no place in free text that is later placed inside a prompt.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(facts)) return { ok: false, error: 'התיאור מכיל תווים לא תקינים.' };

  return { ok: true, value: { businessType, serviceAreas, phrases, facts } };
}

/** "ב" + place name, e.g. חיפה -> בחיפה. */
const inCity = (c: string) => `ב${c}`;

const TEMPLATES: Array<(t: string, c: string) => string> = [
  (t, c) => `${t} ${inCity(c)}`,
  (t, c) => `${t} מומלץ ${inCity(c)}`,
  (t, c) => `שירותי ${t} ${inCity(c)}`,
  (t, c) => `${t} באזור ${c}`,
  (t, c) => `איך בוחרים ${t} ${inCity(c)}`,
];

/**
 * Up to MAX_PHRASES suggestions, interleaved across areas so every area gets its core phrase
 * before any area gets a second variation.
 */
export function suggestPhrases(businessType: string, areas: string[]): string[] {
  const out: string[] = [];
  for (const tpl of TEMPLATES) {
    for (const area of areas) {
      if (out.length >= MAX_PHRASES) return out;
      out.push(tpl(businessType, area));
    }
  }
  return out;
}
