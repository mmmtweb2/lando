// "AI readiness" of a business website (public Audit, task #8). Four plain checks, each ✓/✗ with a
// one-line explanation and how to fix it:
//   1. robots.txt does not block the crawlers that feed AI answers and search (OAI-SearchBot,
//      PerplexityBot, Googlebot, Bingbot);
//   2. the page has real text in its HTML (not an empty shell that needs JavaScript);
//   3. LocalBusiness structured data (JSON-LD) exists;
//   4. prices and service areas are written as visible text (not only in an image or a PDF).
//
// The website is fetched from our server through safeFetch (SSRF-safe). Nothing is stored.
// An unreachable website never breaks the audit: the block just says it could not be checked.

import { safeGetText, type SafeResponse } from './safeFetch';

export const AI_BOTS = [
  { agent: 'OAI-SearchBot', label: 'ChatGPT' },
  { agent: 'PerplexityBot', label: 'Perplexity' },
  { agent: 'Googlebot', label: 'גוגל' },
  { agent: 'Bingbot', label: 'Bing' },
] as const;

// ── robots.txt ───────────────────────────────────────────────────────────────

export interface RobotsGroup { agents: string[]; rules: Array<{ allow: boolean; pattern: string }> }

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!cur) continue;
      if (key === 'disallow' && val === '') continue; // empty Disallow = nothing is blocked
      cur.rules.push({ allow: key === 'allow', pattern: val });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

/** Standard robots rules: the most specific group wins, then the longest matching pattern, Allow on ties. */
export function robotsAllows(groups: RobotsGroup[], agent: string, path = '/'): boolean {
  const a = agent.toLowerCase();
  let matched = groups.filter(g => g.agents.includes(a));
  if (!matched.length) matched = groups.filter(g => g.agents.includes('*'));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of matched) {
    for (const r of g.rules) {
      if (!patternMatches(r.pattern, path)) continue;
      const len = r.pattern.length;
      if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

// ── page content ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

/** Text a visitor (or a crawler that does not run JavaScript) would see. */
export function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|quot|lt|gt|#39);/g, m => ENTITIES[m] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const MIN_VISIBLE_CHARS = 300;

const LOCAL_TYPES = new Set([
  'localbusiness', 'store', 'restaurant', 'cafeorcoffeeshop', 'barorpub', 'bakery', 'foodestablishment', 'fastfoodrestaurant',
  'hairsalon', 'beautysalon', 'healthandbeautybusiness', 'daySpa', 'spa', 'nailsalon', 'tattooparlor',
  'dentist', 'physician', 'medicalclinic', 'medicalbusiness', 'optician', 'pharmacy', 'veterinarycare',
  'legalservice', 'attorney', 'notary', 'accountingservice', 'financialservice', 'insuranceagency', 'professionalservice',
  'plumber', 'electrician', 'locksmith', 'hvacbusiness', 'roofingcontractor', 'generalcontractor', 'housepainter',
  'homeandconstructionbusiness', 'movingcompany', 'autorepair', 'automotivebusiness', 'autodealer', 'carwash',
  'gym', 'healthclub', 'sportsactivitylocation', 'realestateagent', 'travelagency', 'lodgingbusiness', 'hotel',
  'childcare', 'drycleaningorlaundry', 'florist', 'clothingstore', 'furniturestore', 'petstore', 'jewelrystore',
  'electronicsstore', 'bookstore', 'hardwarestore', 'grocerystore', 'shoestore', 'entertainmentbusiness', 'selfstorage',
].map(s => s.toLowerCase()));

/** true when the page carries LocalBusiness (or a recognised sub-type) JSON-LD. */
export function hasLocalBusinessSchema(html: string): boolean {
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const visit = (node: unknown, depth: number): boolean => {
    if (depth > 6 || node === null || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(n => visit(n, depth + 1));
    const o = node as Record<string, unknown>;
    const t = o['@type'];
    const types = (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
    if (types.some(x => LOCAL_TYPES.has(x.replace(/^.*[/#]/, '').toLowerCase()))) return true;
    return Object.values(o).some(v => visit(v, depth + 1));
  };
  while ((m = re.exec(html))) {
    try { if (visit(JSON.parse(m[1].trim()), 0)) return true; } catch { /* malformed block: ignore */ }
  }
  return false;
}

const PRICE_RE = /(₪\s?\d|\d\s?₪|\d[\d,.]*\s?(ש["״']?ח|שקל|שקלים)|מחיר(ון|ים|י)?(?![א-ת])|החל\s?מ[־-]?\s?\d)/;
const AREA_RE = /(אזורי?\s(ה)?שירות|אזור\sהפעילות|אנו\sמשרתים|משרתים\sאת|אנחנו\sמגיעים|מגיעים\sל|מגיעים\sעד|שירות\sב(כל\s)?(רחבי|אזור)|בפריסה\sארצית|בכל\sרחבי\sהארץ|הגעה\sעד\sאליכם)/;

export function hasPrices(text: string): boolean { return PRICE_RE.test(text); }
export function hasServiceArea(text: string): boolean { return AREA_RE.test(text); }

// ── result ───────────────────────────────────────────────────────────────────

export type CheckState = 'pass' | 'fail' | 'unknown';
export interface ReadinessCheck { key: 'robots' | 'content' | 'schema' | 'facts'; label: string; state: CheckState; detail: string; fix: string }
export interface AiReadiness {
  status: 'ok' | 'no_website' | 'unreachable';
  /** Host only (no path or query) — enough to show which site was checked. */
  host: string | null;
  checks: ReadinessCheck[];
}

export interface ReadinessDeps { get: (url: string) => Promise<SafeResponse | null> }
const realDeps: ReadinessDeps = { get: (url) => safeGetText(url) };

export function buildChecks(
  robots: { state: 'missing' | 'found' | 'unknown'; text?: string },
  html: string,
): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  // 1. robots.txt
  if (robots.state === 'unknown') {
    checks.push({ key: 'robots', label: 'גישה לבוטים של חיפוש ו-AI', state: 'unknown',
      detail: 'לא הצלחנו לקרוא את robots.txt של האתר.', fix: 'ודאו שהקובץ example.co.il/robots.txt נפתח בדפדפן.' });
  } else {
    const groups = robots.state === 'found' ? parseRobots(robots.text ?? '') : [];
    const blockedBots = AI_BOTS.filter(b => !robotsAllows(groups, b.agent, '/'));
    checks.push(blockedBots.length === 0
      ? { key: 'robots', label: 'גישה לבוטים של חיפוש ו-AI', state: 'pass',
          detail: robots.state === 'missing' ? 'אין robots.txt, כלומר שום בוט לא נחסם.' : 'robots.txt לא חוסם את הבוטים של ChatGPT, Perplexity, גוגל ו-Bing.', fix: '' }
      : { key: 'robots', label: 'גישה לבוטים של חיפוש ו-AI', state: 'fail',
          detail: `robots.txt חוסם את: ${blockedBots.map(b => b.label).join(', ')}. הם לא יוכלו להציג את האתר שלכם בתשובות.`,
          fix: 'בקשו ממי שבנה את האתר להסיר את החסימה (Disallow: /) לבוטים האלה ב-robots.txt.' });
  }

  // 2. text without JavaScript
  const text = visibleText(html);
  checks.push(text.length >= MIN_VISIBLE_CHARS
    ? { key: 'content', label: 'תוכן שנראה גם בלי JavaScript', state: 'pass',
        detail: 'יש בעמוד טקסט אמיתי שבוט יכול לקרוא.', fix: '' }
    : { key: 'content', label: 'תוכן שנראה גם בלי JavaScript', state: 'fail',
        detail: 'כמעט שאין טקסט בקוד העמוד. בוטים שלא מריצים JavaScript רואים עמוד ריק.',
        fix: 'אתר שנבנה כדף נחיתה רגיל (כמו ב-Pagey) מציג את התוכן ישירות. באתר שנטען רק בדפדפן, יש להוסיף רינדור בצד השרת.' });

  // 3. LocalBusiness schema
  checks.push(hasLocalBusinessSchema(html)
    ? { key: 'schema', label: 'סכמת LocalBusiness', state: 'pass',
        detail: 'האתר מצהיר במפורש על פרטי העסק בצורה שמכונה מבינה.', fix: '' }
    : { key: 'schema', label: 'סכמת LocalBusiness', state: 'fail',
        detail: 'אין באתר סימון מובנה (JSON-LD) של פרטי העסק: שם, כתובת, טלפון ושעות.',
        fix: 'מוסיפים לעמוד הבית בלוק JSON-LD מסוג LocalBusiness עם פרטי העסק.' });

  // 4. prices and service areas as visible text
  const prices = hasPrices(text);
  const area = hasServiceArea(text);
  checks.push(prices && area
    ? { key: 'facts', label: 'מחירים ואזורי שירות בטקסט', state: 'pass',
        detail: 'מחירים ואזורי שירות כתובים בטקסט גלוי.', fix: '' }
    : { key: 'facts', label: 'מחירים ואזורי שירות בטקסט', state: 'fail',
        detail: `לא מצאנו בטקסט הגלוי ${!prices && !area ? 'מחירים או אזורי שירות' : !prices ? 'מחירים' : 'אזורי שירות'}. מידע שנמצא רק בתמונה או ב-PDF לא נקרא על ידי בוטים.`,
        fix: 'כותבים בטקסט רגיל בעמוד: "החל מ-X ₪" ואת הערים והאזורים שבהם אתם נותנים שירות.' });

  return checks;
}

export async function checkAiReadiness(website: string | null | undefined, deps: ReadinessDeps = realDeps): Promise<AiReadiness> {
  if (!website) return { status: 'no_website', host: null, checks: [] };
  let u: URL;
  try { u = new URL(website); } catch { return { status: 'unreachable', host: null, checks: [] }; }
  const host = u.hostname.replace(/^www\./, '');
  const [page, robotsRes] = await Promise.all([
    deps.get(u.toString()).catch(() => null),
    deps.get(`${u.origin}/robots.txt`).catch(() => null),
  ]);
  if (!page || page.status < 200 || page.status >= 400) return { status: 'unreachable', host, checks: [] };
  const robots = !robotsRes || robotsRes.status >= 500 ? { state: 'unknown' as const }
    : robotsRes.status === 404 || robotsRes.status === 410 ? { state: 'missing' as const }
    : robotsRes.status >= 200 && robotsRes.status < 300 ? { state: 'found' as const, text: robotsRes.text }
    : { state: 'unknown' as const };
  return { status: 'ok', host, checks: buildChecks(robots, page.text) };
}
