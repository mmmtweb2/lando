// "כרטיס האמת" — the business facts every automation writes from (docs/mvp-plan.md, A1). Pure, no I/O.
//
// The card is read from the customer's Google Business Profile, completed by the customer, and
// approved once. Posts, review replies, the landing page and the phrase pages may state ONLY what
// is in it. Everything that arrives from Google or from the customer is cleaned here: these strings
// end up in prompts, in Google posts and in HTML.

export type Day = 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY';
export const DAYS: Day[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
export const DAY_HE: Record<Day, string> = { SUNDAY: 'ראשון', MONDAY: 'שני', TUESDAY: 'שלישי', WEDNESDAY: 'רביעי', THURSDAY: 'חמישי', FRIDAY: 'שישי', SATURDAY: 'שבת' };

export interface TruthService { name: string; description: string; source: 'google' | 'customer' }
export interface TruthHours { day: Day; open: string; close: string }
export interface TruthCard {
  name: string; phone: string; website: string; address: string; city: string;
  category: string; categories: string[];
  description: string;
  services: TruthService[];
  areas: string[];
  hours: TruthHours[];
  /** false when Google marks the business closed (temporarily or permanently). */
  open: boolean;
  reviewUrl: string; mapsUrl: string;
  /** Free text from the customer: what is special about the business. Facts for the writer, never published as is. */
  notes: string;
}

export const MAX_SERVICES = 20;
export const MAX_AREAS = 10;
export const MAX_DESCRIPTION = 750; // Google's own limit for the profile description
export const MAX_NOTES = 1000;

export const emptyCard = (): TruthCard => ({
  name: '', phone: '', website: '', address: '', city: '', category: '', categories: [], description: '',
  services: [], areas: [], hours: [], open: true, reviewUrl: '', mapsUrl: '', notes: '',
});

/** One line of plain text: no control or bidi-override characters, collapsed spaces, capped. */
export function line(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Several lines of plain text (description, notes): keeps newlines, drops other control characters. */
export function para(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

const httpsUrl = (v: unknown): string => {
  const s = line(v, 300);
  return /^https?:\/\/[^\s<>"']+$/i.test(s) ? s : '';
};

const hhmm = (t: any): string | null => {
  const h = Number(t?.hours ?? 0), m = Number(t?.minutes ?? 0);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 24 || m < 0 || m > 59 || (h === 24 && m !== 0)) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const TIME_RE = /^([01]\d|2[0-4]):[0-5]\d$/;

function dedupe<T>(items: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((x) => { const k = key(x).toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/** "תל אביב-יפו, ישראל" -> "תל אביב-יפו". */
const areaName = (v: unknown): string => line(v, 60).replace(/,\s*(ישראל|Israel)$/i, '').trim();

/**
 * Google's location resource (Business Information API v1) -> a card. Unknown or malformed fields
 * are skipped, never guessed. Structured service items carry only an id; their display name is
 * looked up in the service types Google lists under the location's categories.
 */
export function parseLocation(raw: any): TruthCard {
  const c = emptyCard();
  if (!raw || typeof raw !== 'object') return c;
  c.name = line(raw.title, 100);
  c.phone = line(raw.phoneNumbers?.primaryPhone, 30);
  c.website = httpsUrl(raw.websiteUri);
  const addr = raw.storefrontAddress;
  c.city = line(addr?.locality, 60);
  c.address = [...(Array.isArray(addr?.addressLines) ? addr.addressLines : []), addr?.locality].map((x: unknown) => line(x, 100)).filter(Boolean).join(', ').slice(0, 200);
  const cats = [raw.categories?.primaryCategory, ...(Array.isArray(raw.categories?.additionalCategories) ? raw.categories.additionalCategories : [])].filter(Boolean);
  c.category = line(cats[0]?.displayName, 80);
  c.categories = dedupe(cats.slice(1).map((x: any) => line(x?.displayName, 80)), (x) => x).slice(0, 9);
  c.description = para(raw.profile?.description, MAX_DESCRIPTION);

  const typeNames = new Map<string, string>();
  for (const cat of cats) for (const t of (Array.isArray(cat?.serviceTypes) ? cat.serviceTypes : [])) {
    if (typeof t?.serviceTypeId === 'string') typeNames.set(t.serviceTypeId, line(t.displayName, 60));
  }
  const services: TruthService[] = [];
  for (const it of (Array.isArray(raw.serviceItems) ? raw.serviceItems : [])) {
    const free = it?.freeFormServiceItem?.label, st = it?.structuredServiceItem;
    const name = free ? line(free.displayName, 60) : (typeof st?.serviceTypeId === 'string' ? typeNames.get(st.serviceTypeId) ?? '' : '');
    if (name) services.push({ name, description: line(free?.description ?? st?.description, 300), source: 'google' });
  }
  c.services = dedupe(services, (s) => s.name).slice(0, MAX_SERVICES);

  const infos = raw.serviceArea?.places?.placeInfos;
  c.areas = dedupe([...(Array.isArray(infos) ? infos.map((p: any) => areaName(p?.placeName)) : []), c.city], (x) => x).slice(0, MAX_AREAS);

  const hours: TruthHours[] = [];
  for (const p of (Array.isArray(raw.regularHours?.periods) ? raw.regularHours.periods : [])) {
    const open = hhmm(p?.openTime), close = hhmm(p?.closeTime);
    if (DAYS.includes(p?.openDay) && open && close) hours.push({ day: p.openDay, open, close });
  }
  c.hours = hours.slice(0, 21);
  c.open = raw.openInfo?.status ? raw.openInfo.status === 'OPEN' : true;
  c.reviewUrl = httpsUrl(raw.metadata?.newReviewUri);
  c.mapsUrl = httpsUrl(raw.metadata?.mapsUri);
  return c;
}

/**
 * A fresh read from Google over what we already hold. Google wins for what Google owns (name,
 * address, category, links, open state) and for any field it has a value for; what the customer
 * added here (their own services, areas, notes) is kept.
 */
export function mergeFromGoogle(prev: TruthCard | null, fresh: TruthCard): TruthCard {
  if (!prev) return fresh;
  const mine = prev.services.filter((s) => s.source === 'customer');
  return {
    ...fresh,
    phone: fresh.phone || prev.phone,
    website: fresh.website || prev.website,
    description: fresh.description || prev.description,
    hours: fresh.hours.length ? fresh.hours : prev.hours,
    services: dedupe([...fresh.services, ...mine], (s) => s.name).slice(0, MAX_SERVICES),
    areas: dedupe([...fresh.areas, ...prev.areas], (x) => x).slice(0, MAX_AREAS),
    notes: prev.notes,
  };
}

export class CardInputError extends Error {
  constructor(public readonly field: string) { super(`bad_${field}`); }
}

const NO_LINKS = /https?:|www\.|@/i;

/**
 * The customer's edit, applied over the stored card. Name, address and category stay as Google
 * has them (changing those belongs in Google, where it can trigger re-verification). Throws
 * CardInputError naming the first bad field; never silently drops what the customer typed.
 */
export function applyEdit(base: TruthCard, input: any): TruthCard {
  if (!input || typeof input !== 'object') throw new CardInputError('body');
  const out: TruthCard = { ...base };
  if ('phone' in input) {
    const p = line(input.phone, 30);
    if (p && !/^[+\d][\d\s()-]{6,28}$/.test(p)) throw new CardInputError('phone');
    out.phone = p;
  }
  if ('website' in input) {
    const w = line(input.website, 300);
    if (w && !httpsUrl(w)) throw new CardInputError('website');
    out.website = w;
  }
  if ('description' in input) {
    if (typeof input.description !== 'string' || input.description.length > MAX_DESCRIPTION * 2) throw new CardInputError('description');
    out.description = para(input.description, MAX_DESCRIPTION);
  }
  if ('notes' in input) {
    if (typeof input.notes !== 'string' || input.notes.length > MAX_NOTES * 2) throw new CardInputError('notes');
    out.notes = para(input.notes, MAX_NOTES);
  }
  if ('services' in input) {
    if (!Array.isArray(input.services) || input.services.length > MAX_SERVICES) throw new CardInputError('services');
    const known = new Map(base.services.map((s) => [s.name.toLowerCase(), s]));
    out.services = dedupe(input.services.map((s: any): TruthService => {
      const name = line(typeof s === 'string' ? s : s?.name, 60);
      const description = line(typeof s === 'string' ? '' : s?.description, 300);
      if (name.length < 2 || NO_LINKS.test(name) || NO_LINKS.test(description)) throw new CardInputError('services');
      const was = known.get(name.toLowerCase());
      return { name, description, source: was && was.description === description ? was.source : 'customer' };
    }), (s: TruthService) => s.name);
  }
  if ('areas' in input) {
    if (!Array.isArray(input.areas) || input.areas.length > MAX_AREAS) throw new CardInputError('areas');
    out.areas = dedupe(input.areas.map((a: unknown) => {
      const s = line(a, 60);
      if (s.length < 2 || NO_LINKS.test(s)) throw new CardInputError('areas');
      return s;
    }), (x: string) => x);
  }
  if ('hours' in input) {
    if (!Array.isArray(input.hours) || input.hours.length > 21) throw new CardInputError('hours');
    out.hours = input.hours.map((h: any): TruthHours => {
      if (!DAYS.includes(h?.day) || !TIME_RE.test(h?.open) || !TIME_RE.test(h?.close)) throw new CardInputError('hours');
      return { day: h.day, open: h.open, close: h.close };
    });
  }
  return out;
}

// ── Readiness ────────────────────────────────────────────────────────────────

export type CheckState = 'ok' | 'weak' | 'missing';
export interface ReadinessCheck {
  key: 'open' | 'phone' | 'category' | 'services' | 'description' | 'hours' | 'areas' | 'website' | 'notes';
  state: CheckState;
  /** Without this one we do not start working (a post with nothing true to say helps nobody). */
  required: boolean;
  title: string;
  why: string;
}
export interface Readiness { checks: ReadinessCheck[]; ready: boolean; done: number; total: number }

export const MIN_SERVICES_GOOD = 3;
export const MIN_DESCRIPTION_GOOD = 120;

/** What is filled, what is thin and what is missing, in the customer's language. */
export function readiness(c: TruthCard): Readiness {
  const s = (ok: boolean, weak = false): CheckState => (ok ? 'ok' : weak ? 'weak' : 'missing');
  const checks: ReadinessCheck[] = [
    { key: 'open', required: true, state: s(c.open), title: 'העסק מסומן כפתוח בגוגל', why: 'גוגל כמעט לא מציגה עסק שמסומן כסגור, ואי אפשר לפרסם בכרטיס שלו.' },
    { key: 'category', required: true, state: s(!!c.category), title: 'קטגוריה ראשית', why: 'לפי הקטגוריה גוגל מחליטה באילו חיפושים להציג אתכם.' },
    { key: 'phone', required: true, state: s(!!c.phone), title: 'טלפון', why: 'רוב הפניות מכרטיס העסק הן שיחות טלפון.' },
    { key: 'services', required: true, state: s(c.services.length >= MIN_SERVICES_GOOD, c.services.length > 0), title: 'רשימת שירותים', why: 'מהשירותים אנחנו כותבים את הפוסטים ואת הדפים, וגוגל מתאימה אותם לחיפושים.' },
    { key: 'description', required: false, state: s(c.description.length >= MIN_DESCRIPTION_GOOD, c.description.length > 0), title: 'תיאור העסק', why: 'תיאור מלא עוזר ללקוח להחליט לפנות, ולגוגל להבין מה אתם עושים.' },
    { key: 'hours', required: false, state: s(c.hours.length > 0), title: 'שעות פעילות', why: 'עסק בלי שעות מוצג פחות, ולקוחות חוששים להגיע.' },
    { key: 'areas', required: false, state: s(c.areas.length > 0), title: 'אזורי שירות', why: 'כך אנחנו יודעים על אילו יישובים לכתוב.' },
    { key: 'website', required: false, state: s(!!c.website), title: 'אתר או דף נחיתה', why: 'קישור מהכרטיס מוסיף אמינות ונותן ללקוח מקום להשאיר פרטים.' },
    { key: 'notes', required: false, state: s(c.notes.length >= 40, c.notes.length > 0), title: 'מה מיוחד אצלכם', why: 'כמה משפטים משלכם הופכים את הפוסטים מכלליים לאישיים.' },
  ];
  return {
    checks,
    ready: checks.every((k) => !k.required || k.state !== 'missing'),
    done: checks.filter((k) => k.state === 'ok').length,
    total: checks.length,
  };
}

/** Compact hours for prose: days with the same hours are listed together. */
export function hoursText(hours: TruthHours[]): string {
  const by = new Map<string, Day[]>();
  for (const d of DAYS) {
    const spans = hours.filter((h) => h.day === d).map((h) => `${h.open}-${h.close}`).join(', ');
    if (spans) by.set(spans, [...(by.get(spans) ?? []), d]);
  }
  return [...by.entries()].map(([spans, days]) => `${days.map((d) => DAY_HE[d]).join(', ')}: ${spans}`).join('; ');
}

/**
 * Everything a writer may rely on, as one block of text. It is also the whitelist for numbers:
 * a sentence with a number that does not appear here is dropped from generated text.
 */
export function factsText(c: TruthCard): string {
  return [
    c.name && `שם העסק: ${c.name}`,
    c.category && `תחום: ${[c.category, ...c.categories].join(', ')}`,
    c.services.length && `שירותים: ${c.services.map((s) => (s.description ? `${s.name} (${s.description})` : s.name)).join('; ')}`,
    c.areas.length && `אזורי שירות: ${c.areas.join(', ')}`,
    c.address && `כתובת: ${c.address}`,
    c.hours.length && `שעות פעילות: ${hoursText(c.hours)}`,
    c.phone && `טלפון: ${c.phone}`,
    c.description && `תיאור העסק: ${c.description}`,
    c.notes && `מה מיוחד בעסק (מפי בעל העסק): ${c.notes}`,
  ].filter(Boolean).join('\n');
}

// ── A landing page from the card (docs/mvp-plan.md, C1) ──────────────────────

export interface LandingInput {
  business_name: string; phone_number: string; vibe: string; image_source: 'stock';
  address: string; business_hours: string; about_business: string; user_provided_text: string;
  enable_form: 'true'; cta_type: 'whatsapp' | 'phone'; page_goal: 'lead_gen';
}

/** An Israeli mobile number (05x…, +9725x…): WhatsApp works on it. A landline gets a call button. */
export const isMobile = (phone: string): boolean => /^(?:\+?972|0)5\d{8}$/.test(phone.replace(/[^\d+]/g, ''));

/**
 * The same fields the page wizard collects, filled from the approved card, so that one press
 * creates a complete draft: the customer only reads it and presses publish. Everything the page
 * writer may state comes from here; it invents nothing (same rule as the wizard's writer).
 */
export function landingInputFromCard(c: TruthCard): LandingInput {
  const services = c.services.map((s) => (s.description ? `${s.name}: ${s.description}` : s.name));
  return {
    business_name: c.name.slice(0, 120),
    phone_number: c.phone.replace(/[^\d+]/g, '').slice(0, 20),
    vibe: [c.category, ...c.categories.slice(0, 2)].filter(Boolean).join(', ').slice(0, 200) || c.name,
    image_source: 'stock',
    address: c.address,
    business_hours: DAYS.map((d) => { const h = c.hours.filter((x) => x.day === d).map((x) => `${x.open}–${x.close}`).join(', '); return h ? `יום ${DAY_HE[d]}: ${h}` : ''; }).filter(Boolean).join('\n').slice(0, 500),
    about_business: [c.description, c.notes].filter(Boolean).join('\n\n').slice(0, 1500),
    user_provided_text: [
      services.length ? `השירותים שלנו:\n${services.map((s) => `- ${s}`).join('\n')}` : '',
      c.areas.length ? `אזורי שירות: ${c.areas.join(', ')}` : '',
    ].filter(Boolean).join('\n\n').slice(0, 3000),
    enable_form: 'true',
    cta_type: isMobile(c.phone) ? 'whatsapp' : 'phone',
    page_goal: 'lead_gen',
  };
}
