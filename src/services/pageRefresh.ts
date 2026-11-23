// "עדכון הדף לפי פרטי העסק" (README part 146). Pure rules, no I/O.
//
// A page built from the Google business card BEFORE the card had good details keeps its old texts: the practical
// facts (phone, address, hours, areas, accessibility) already come live from the card (part 143), but the page's
// own words (hero, about, services, benefits, process, FAQ...) never change. This rewrites ONLY those words from
// the CURRENT card, through the same writer as page creation (ai.service generateAiContent), and lets the owner
// pick section by section what to replace.
//
// Never touched: images (user_images, logo), colours and design, slug, publish state, hidden sections, contact
// details, real testimonials, the doctor-and-team section, spoken languages, practical info, and section headings
// the page already has (they may be the owner's own). The services list is the CARD's list, never invented.

import type { AiContent, GenerateInput, ServiceItem } from './ai.service';
import type { TruthCard } from './businessTruth';
import type { AttributeMeta } from './gbpAttributes';
import { hoursLines } from './pageGoogle';
import { israelDay } from './businessPolish';
import { type CategoryId, detectCategory, normalizeCategory } from './pageCategory';

// ── Sections ─────────────────────────────────────────────────────────────────

export type RefreshSectionId = 'hero' | 'about' | 'services' | 'benefits' | 'process' | 'faq' | 'closing' | 'seo';

/** In page order. The labels are what the owner reads in the review. */
export const REFRESH_SECTIONS: ReadonlyArray<{ id: RefreshSectionId; label: string }> = [
  { id: 'hero', label: 'הפתיחה' },
  { id: 'about', label: 'על העסק' },
  { id: 'services', label: 'השירותים' },
  { id: 'benefits', label: 'היתרונות' },
  { id: 'process', label: 'שלבי העבודה' },
  { id: 'faq', label: 'שאלות נפוצות' },
  { id: 'closing', label: 'שורת הסיום ותגי האמון' },
  { id: 'seo', label: 'הכותרת והתיאור בתוצאות החיפוש' },
];

export const isRefreshSection = (x: unknown): x is RefreshSectionId => REFRESH_SECTIONS.some((s) => s.id === x);

// ── The card ─────────────────────────────────────────────────────────────────

/** Enough on the card to write a page from: a name, and a description or at least one service. */
export function cardUsable(card: TruthCard | null | undefined): card is TruthCard {
  return !!card && !!card.name?.trim() && (!!card.description?.trim() || (card.services ?? []).some((s) => !!s.name?.trim()));
}

/** Attributes set to YES, by their Hebrew name from Google (unknown names are left out). */
export function yesAttributes(card: TruthCard, meta: readonly AttributeMeta[] = []): string[] {
  const label = new Map(meta.map((m) => [m.name, m.label]));
  return Object.entries(card.attributes ?? {}).filter(([, v]) => v === true).map(([k]) => label.get(k) ?? '').filter(Boolean).sort();
}

const areasOf = (card: TruthCard): string[] =>
  [...new Set([...(card.serviceArea?.places ?? []).map((p) => p.name), ...(card.areas ?? [])].map((s) => (s ?? '').trim()).filter(Boolean))].slice(0, 20);

/** The address the page may name: none when the listing hides it (the business only goes to customers). */
export const cardAddress = (card: TruthCard): string => (card.serviceArea?.type === 'CUSTOMER_LOCATION_ONLY' ? '' : card.address || '');

/**
 * The card's facts for the writer, as the "פרטים נוספים שסופקו" block the prompts already know (they must use
 * these verbatim and invent nothing beyond them). The notes are facts for the writer, never published as is.
 */
export function cardFactsText(card: TruthCard, meta: readonly AttributeMeta[] = []): string {
  const lines: string[] = ['פרטים נוספים שסופקו (מכרטיס העסק, מעודכנים):'];
  if (card.category) lines.push(`- תחום: ${[card.category, ...(card.categories ?? [])].join(', ')}`);
  const services = (card.services ?? []).filter((s) => s.name?.trim());
  if (services.length) {
    lines.push('- השירותים (רק אלה, בסדר הזה, בלי להוסיף שירותים אחרים):');
    for (const s of services) lines.push(`  • ${s.name.trim()}${s.description?.trim() ? `: ${s.description.trim()}` : ''}`);
  }
  const areas = areasOf(card);
  if (areas.length) lines.push(`- אזורי שירות: ${areas.join(', ')}`);
  const attrs = yesAttributes(card, meta);
  if (attrs.length) lines.push(`- מאפיינים: ${attrs.join(', ')}`);
  const hours = card.open ? hoursLines(card.hours ?? []) : '';
  if (hours) lines.push(`- שעות פעילות: ${hours.replace(/\n/g, '; ')}`);
  if (!card.open) lines.push('- העסק מסומן בגוגל כסגור כרגע: אל תציינו שעות.');
  if (card.notes?.trim()) lines.push(`- מה שבעל העסק סיפר על העסק: ${card.notes.trim()}`);
  return lines.join('\n');
}

/** Everything the card says about what the business does: what the category detection reads. */
export function cardSourceText(card: TruthCard): string {
  return [card.description, ...(card.services ?? []).map((s) => `${s.name} ${s.description ?? ''}`), card.notes].filter(Boolean).join('\n');
}

export interface RefreshPage {
  business_name?: string | null;
  phone_number?: string | null;
  design_style?: string | null;
  page_goal?: string | null;
  about_business?: string | null;
  ai_content?: AiContent | null;
  category?: string | null;
  category_source?: string | null;
}

/** Re-detected from the card only when the owner did not choose the category by hand. */
export function nextCategory(page: RefreshPage, card: TruthCard): CategoryId {
  if (page.category_source === 'manual') return normalizeCategory(page.category);
  return detectCategory({ description: cardSourceText(card), googleCategory: card.category || null, businessName: card.name }).id;
}

/** The writer's input, from the CURRENT card. The page's own goal, style and contact method stay. */
export function cardToGenerateInput(card: TruthCard, meta: readonly AttributeMeta[], page: RefreshPage, category: CategoryId): GenerateInput {
  const old = page.ai_content ?? {};
  return {
    business_name: card.name || page.business_name || '',
    phone_number: card.phone || page.phone_number || '',
    address: cardAddress(card) || undefined,
    business_hours: card.open ? hoursLines(card.hours ?? []) || undefined : undefined,
    vibe: [card.category, ...(card.categories ?? [])].filter(Boolean).join(', ') || page.about_business || card.name,
    design_style: page.design_style ?? undefined,
    image_source: 'none',
    about_business: card.description || undefined,
    user_provided_text: cardFactsText(card, meta),
    page_goal: page.page_goal ?? undefined,
    // Testimonials are never rewritten (a real one the owner typed stays): the writer does not need to write any.
    include_testimonials: false,
    category,
    cta_type: old.contact?.cta_type,
  };
}

// ── Services: the card's list, never invented ────────────────────────────────

/** Lower-case, no niqqud or punctuation, single spaces: "תיקון נזילות." = "תיקון  נזילות". */
export const serviceKey = (s: string): string =>
  (s ?? '').normalize('NFKD').replace(/[֑-ׇ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function sameService(a: string, b: string): boolean {
  const x = serviceKey(a), y = serviceKey(b);
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))));
}

/**
 * The services section: exactly the card's services, each once, with the card's name. The description is the
 * card's own when it has one (the owner's words), else the writer's sentence for that service, else empty.
 * A service the page already had (same name) keeps its id and image words, and stays at its old position when
 * it can, so a per-position service picture keeps showing the same service. Nothing on the card = null (the
 * section is not offered: anything else would be invented).
 */
export function servicesFromCard(cardServices: TruthCard['services'], written: ServiceItem[] | undefined, old: ServiceItem[] | undefined): ServiceItem[] | null {
  const list = (cardServices ?? []).filter((s) => s.name?.trim());
  if (!list.length) return null;
  const w = written ?? [];
  const prev = old ?? [];
  const usedOld = new Set<number>();
  const items = list.map((s, i) => {
    const name = s.name.trim();
    const wrote = w.find((x) => sameService(x.title, name)) ?? (w.length === list.length ? w[i] : undefined);
    const j = prev.findIndex((x, k) => !usedOld.has(k) && sameService(x.title, name));
    if (j >= 0) usedOld.add(j);
    const was = j >= 0 ? prev[j] : undefined;
    const item: ServiceItem = {
      id: was?.id ?? `c${i + 1}`,
      title: name,
      description: s.description?.trim() || wrote?.description?.trim() || '',
    };
    const imgPrompt = was?.service_image_prompt ?? wrote?.service_image_prompt;
    const icon = was?.service_icon_keyword ?? wrote?.service_icon_keyword;
    if (imgPrompt) item.service_image_prompt = imgPrompt;
    if (icon) item.service_icon_keyword = icon;
    return { item, oldIndex: j };
  });
  // Matched services go back to their old position when it is free; the rest fill the gaps in card order.
  const out: Array<ServiceItem | undefined> = new Array(items.length).fill(undefined);
  const rest: ServiceItem[] = [];
  for (const { item, oldIndex } of items) {
    if (oldIndex >= 0 && oldIndex < out.length && !out[oldIndex]) out[oldIndex] = item;
    else rest.push(item);
  }
  for (let k = 0; k < out.length; k++) if (!out[k]) out[k] = rest.shift();
  return out as ServiceItem[];
}

/** The candidate: what the writer returned, with the card's services in place of the written ones. */
export function buildCandidate(written: AiContent, card: TruthCard, old: AiContent | null | undefined): AiContent {
  const services = servicesFromCard(card.services, written.services_or_benefits ?? written.services, old?.services_or_benefits ?? old?.services);
  const c: AiContent = { ...written };
  delete c.services;
  if (services) c.services_or_benefits = services; else delete c.services_or_benefits;
  return c;
}

// ── Merge ────────────────────────────────────────────────────────────────────

export interface MergeOptions {
  /** The template changed with this refresh (general -> health): its fixed headings come with it. */
  categoryChanged?: boolean;
}

const has = (v: unknown): boolean => (typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : !!v);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** A heading the page has stays (it may be the owner's); the new one fills only an empty place. */
function heading(old: string | undefined, next: string | undefined, o: MergeOptions): string | undefined {
  if (o.categoryChanged) return next || old;
  return has(old) ? old : next || undefined;
}

/**
 * The page content after the refresh: a copy of the current content with ONLY the selected text sections taken
 * from the candidate. Everything else (and every non-text field inside a section, like the hero image prompt)
 * is the page's own. A section the candidate has nothing for is skipped.
 */
export function mergeRefresh(old: AiContent, cand: AiContent, selected: readonly RefreshSectionId[], o: MergeOptions = {}): AiContent {
  const out: AiContent = clone(old ?? {});
  const want = new Set(selected);
  if (want.has('hero') && (has(cand.hero?.title) || has(cand.hero?.subtitle))) {
    const h = { ...(out.hero ?? {}) };
    if (has(cand.hero?.title)) h.title = cand.hero!.title;
    if (has(cand.hero?.subtitle)) { h.subtitle = cand.hero!.subtitle; delete h.slogan; }
    if (has(cand.hero?.primary_cta_text)) h.primary_cta_text = cand.hero!.primary_cta_text;
    out.hero = h;
  }
  if (want.has('about') && has(cand.about?.content)) {
    out.about = { ...(out.about ?? {}), content: cand.about!.content, heading: heading(old.about?.heading, cand.about?.heading, o) };
  }
  if (want.has('services') && has(cand.services_or_benefits)) {
    out.services_or_benefits = clone(cand.services_or_benefits);
    delete out.services;
    out.services_heading = heading(old.services_heading, cand.services_heading, o);
    out.services_kicker = heading(old.services_kicker, cand.services_kicker, o);
  }
  if (want.has('benefits') && has(cand.benefits)) {
    out.benefits = clone(cand.benefits);
    out.benefits_heading = heading(old.benefits_heading, cand.benefits_heading, o);
    out.benefits_kicker = heading(old.benefits_kicker, cand.benefits_kicker, o);
  }
  if (want.has('process') && has(cand.process_steps)) {
    out.process_steps = clone(cand.process_steps);
    out.process_heading = heading(old.process_heading, cand.process_heading, o);
    out.process_kicker = heading(old.process_kicker, cand.process_kicker, o);
  }
  if (want.has('faq') && has(cand.faq)) {
    out.faq = clone(cand.faq);
    out.faq_heading = heading(old.faq_heading, cand.faq_heading, o);
    out.faq_kicker = heading(old.faq_kicker, cand.faq_kicker, o);
  }
  if (want.has('closing') && (has(cand.cta_banner_subline) || has(cand.trust_badges))) {
    if (has(cand.cta_banner_subline)) out.cta_banner_subline = cand.cta_banner_subline;
    // A health page has no badges by design: the template clears them, and so does the refresh.
    out.trust_badges = has(cand.trust_badges) ? clone(cand.trust_badges) : undefined;
  }
  if (want.has('seo') && (has(cand.seo_title) || has(cand.seo_description))) {
    if (has(cand.seo_title)) out.seo_title = cand.seo_title;
    if (has(cand.seo_description)) out.seo_description = cand.seo_description;
  }
  for (const k of Object.keys(out) as Array<keyof AiContent>) if (out[k] === undefined) delete out[k];
  if (out.about && out.about.heading === undefined) delete out.about.heading;
  return out;
}

// ── What the owner reviews ───────────────────────────────────────────────────

export interface RefreshLine { title?: string; text?: string }
export interface RefreshPreviewSection { id: RefreshSectionId; label: string; before: RefreshLine[]; after: RefreshLine[] }

const L = (title?: string, text?: string): RefreshLine | null => (has(title) || has(text) ? { ...(has(title) ? { title } : {}), ...(has(text) ? { text } : {}) } : null);
const lines = (xs: Array<RefreshLine | null>): RefreshLine[] => xs.filter((x): x is RefreshLine => !!x);

/** A section as the review shows it: short title + text lines. */
export function sectionView(c: AiContent, id: RefreshSectionId): RefreshLine[] {
  switch (id) {
    case 'hero': return lines([L(c.hero?.title, c.hero?.subtitle ?? c.hero?.slogan), L(undefined, c.hero?.primary_cta_text ? `כפתור: ${c.hero.primary_cta_text}` : undefined)]);
    case 'about': return lines([L(c.about?.heading, c.about?.content)]);
    case 'services': return lines([L(c.services_heading), ...(c.services_or_benefits ?? c.services ?? []).map((s) => L(s.title, s.description))]);
    case 'benefits': return lines([L(c.benefits_heading), ...(c.benefits ?? []).map((b) => L(b.title, b.description))]);
    case 'process': return lines([L(c.process_heading), ...(c.process_steps ?? []).map((s) => L(s.title, s.description))]);
    case 'faq': return lines([L(c.faq_heading), ...(c.faq ?? []).map((f) => L(f.question, f.answer))]);
    case 'closing': return lines([L(undefined, c.cta_banner_subline), L(undefined, (c.trust_badges ?? []).map((b) => b.label).filter(Boolean).join(' · '))]);
    case 'seo': return lines([L(c.seo_title, c.seo_description)]);
  }
}

/** Only the sections the refresh would really change, in page order, with what the page has now and what it would get. */
export function previewSections(old: AiContent, cand: AiContent, o: MergeOptions = {}): RefreshPreviewSection[] {
  const out: RefreshPreviewSection[] = [];
  for (const s of REFRESH_SECTIONS) {
    const after = sectionView(mergeRefresh(old, cand, [s.id], o), s.id);
    const before = sectionView(old ?? {}, s.id);
    if (!after.length || JSON.stringify(after) === JSON.stringify(before)) continue;
    out.push({ id: s.id, label: s.label, before, after });
  }
  return out;
}

// ── The daily allowance ──────────────────────────────────────────────────────

/** Refreshes per page per day (Israel time). Admin runs have their own count. */
export const REFRESH_DAILY_LIMIT = 3;

/** In memory, like the polish counter: a restart forgets the day's count, which only ever errs in the owner's favour. */
export class RefreshCounter {
  private readonly used = new Map<string, number>();
  constructor(private readonly limit = REFRESH_DAILY_LIMIT) {}
  private key(pageId: string, who: string, now: Date) { return `${israelDay(now)}|${who}|${pageId}`; }
  remaining(pageId: string, who = 'owner', now = new Date()): number {
    return Math.max(0, this.limit - (this.used.get(this.key(pageId, who, now)) ?? 0));
  }
  /** Takes one; false when the day's allowance is used up. */
  take(pageId: string, who = 'owner', now = new Date()): boolean {
    this.sweep(now);
    const k = this.key(pageId, who, now);
    const n = this.used.get(k) ?? 0;
    if (n >= this.limit) return false;
    this.used.set(k, n + 1);
    return true;
  }
  /** Gives one back (the writer failed and nothing was shown). */
  refund(pageId: string, who = 'owner', now = new Date()): void {
    const k = this.key(pageId, who, now);
    const n = this.used.get(k) ?? 0;
    if (n <= 1) this.used.delete(k); else this.used.set(k, n - 1);
  }
  private sweep(now: Date) {
    if (this.used.size < 5000) return;
    const today = israelDay(now);
    for (const k of this.used.keys()) if (!k.startsWith(today)) this.used.delete(k);
  }
}

// ── Candidates waiting for the owner's choice ────────────────────────────────

export const CANDIDATE_TTL_MS = 30 * 60_000;

export interface StoredCandidate { pageId: string; candidate: AiContent; category: CategoryId; categoryChanged: boolean; at: number }

/** What the owner is reviewing, kept on the server until "החלפה" (30 minutes). Applied once, then dropped. */
export class CandidateStore {
  private readonly items = new Map<string, StoredCandidate>();
  put(token: string, c: StoredCandidate): void {
    this.items.set(token, c);
    if (this.items.size > 500) this.items.delete(this.items.keys().next().value as string);
  }
  /** The candidate for this page, or null (unknown token, another page, or older than CANDIDATE_TTL_MS). */
  get(token: string, pageId: string, now = Date.now()): StoredCandidate | null {
    const c = this.items.get(token);
    if (!c || c.pageId !== pageId) return null;
    if (now - c.at > CANDIDATE_TTL_MS) { this.items.delete(token); return null; }
    return c;
  }
  drop(token: string): void { this.items.delete(token); }
}
