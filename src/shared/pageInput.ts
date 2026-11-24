// The rules for what a business owner may type into the page wizard (README part 150).
// ONE set of rules, used twice: the wizard checks each field as it is typed and shows the error under it,
// and the server checks the same fields again on create (POST /api/landing) and on edit (PATCH /api/landing/:id),
// because a request can always skip the wizard. This file is pure (no imports, no DOM, no Node) and is copied
// byte for byte to client/src/lib/pageInput.ts; scripts/test-input-validation.ts fails if the two differ.
//
// Pages already stored are never re-checked against these rules: a page created before part 150 keeps
// rendering exactly as it is. Only what is being created or changed now is checked.

export type PageInputField =
  | 'business_name' | 'vibe' | 'phone_number' | 'email' | 'address' | 'business_hours'
  | 'facebook_url' | 'instagram_url' | 'external_link'
  | 'user_provided_text' | 'about_business' | 'testimonial_quote' | 'testimonial_author' | 'intake_answer';

export type LinkField = 'facebook_url' | 'instagram_url' | 'external_link';

/** Most characters each field may hold (after trimming). */
export const PAGE_INPUT_LIMITS: Readonly<Record<PageInputField, number>> = {
  business_name: 120,
  vibe: 200,
  phone_number: 20,
  email: 254,
  address: 200,
  business_hours: 500,
  facebook_url: 500,
  instagram_url: 500,
  external_link: 500,
  user_provided_text: 3000,
  about_business: 2000,
  testimonial_quote: 500,
  testimonial_author: 80,
  intake_answer: 300,
};

/**
 * The wizard sends the free text and the answers to its follow-up questions as one text
 * (user_provided_text + "פרטים נוספים שסופקו"). The server checks that combined text against this.
 */
export const USER_TEXT_COMBINED_MAX = 5000;

/** Fields that may hold several lines. Every other field must be one line. */
const MULTILINE: ReadonlySet<PageInputField> = new Set<PageInputField>([
  'user_provided_text', 'about_business', 'testimonial_quote', 'business_hours',
]);

/** Fields that show a live "n/max" counter in the wizard. */
export const COUNTED_FIELDS: ReadonlySet<PageInputField> = new Set<PageInputField>([
  'user_provided_text', 'testimonial_quote', 'intake_answer', 'business_hours',
]);

export const FIELD_LABELS: Readonly<Record<PageInputField, string>> = {
  business_name: 'השם',
  vibe: 'התחום',
  phone_number: 'מספר הטלפון',
  email: 'כתובת האימייל',
  address: 'הכתובת',
  business_hours: 'שעות הפעילות',
  facebook_url: 'הקישור לפייסבוק',
  instagram_url: 'הקישור לאינסטגרם',
  external_link: 'הקישור',
  user_provided_text: 'הטקסט על העסק',
  about_business: 'התיאור',
  testimonial_quote: 'הציטוט',
  testimonial_author: 'שם הלקוח',
  intake_answer: 'התשובה',
};

export const INPUT_MESSAGES = {
  required: 'זה שדה חובה.',
  tooLong: (max: number, len: number) => `אפשר עד ${max} תווים (כתבתם ${len}). קצרו מעט.`,
  oneLine: 'כתבו את זה בשורה אחת.',
  badChars: 'יש כאן תווים שאי אפשר לשמור. נסו להקליד מחדש.',
  phone: 'מספר הטלפון לא תקין. כתבו מספר ישראלי, למשל 050-1234567, 03-1234567 או 1-700-123-456.',
  email: 'כתובת האימייל לא תקינה. למשל: info@mybusiness.co.il',
  facebook_url: 'צריך קישור לעמוד בפייסבוק, למשל https://facebook.com/mybusiness',
  instagram_url: 'צריך קישור לעמוד באינסטגרם, למשל https://instagram.com/mybusiness',
  external_link: 'הקישור לא תקין. כתבו כתובת מלאה, למשל https://example.co.il',
  linkRequired: 'הכפתור הראשי בדף מפנה לקישור, לכן צריך למלא אותו.',
  summary: 'יש פרטים שצריך לתקן לפני שממשיכים.',
} as const;

// ─── Phone ────────────────────────────────────────────────────────────────────

export type PhoneKind = 'mobile' | 'voip' | 'landline' | 'special';

/** Separators people type inside a phone number. Anything else (letters, "#", "*") is not a phone number. */
const PHONE_SEPARATORS = /[\s\-.()\u200e\u200f\u202a-\u202e]/g;

/**
 * The Israeli number in national form (0501234567, 031234567, 1700123456), or null.
 * Accepts +972 / 972 / 00972 prefixes (with or without the 0 people often keep: +972-050-...),
 * spaces, dashes, dots and brackets. Rejects letters, too few or too many digits, and foreign numbers.
 */
export function normalizeIlPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > PAGE_INPUT_LIMITS.phone_number) return null;
  let d = s.replace(PHONE_SEPARATORS, '');
  if (!/^\+?\d+$/.test(d)) return null;
  const intl = d.match(/^(?:\+|00)?972(\d+)$/);
  if (intl) {
    d = intl[1].replace(/^0/, '');
    if (d.startsWith('1')) return null; // 1-700 / 1-800 numbers cannot be dialled with +972
    d = `0${d}`;
  } else if (d.startsWith('+')) {
    return null; // another country
  }
  return phoneKindOfNational(d) ? d : null;
}

function phoneKindOfNational(d: string): PhoneKind | null {
  if (/^05\d{8}$/.test(d)) return 'mobile';
  if (/^07[2-9]\d{7}$/.test(d)) return 'voip';
  if (/^0[2-489]\d{7}$/.test(d)) return 'landline';
  if (/^1(?:700|800|801|599)\d{6}$/.test(d)) return 'special';
  return null;
}

/** mobile (05x), voip (07x), landline (02/03/04/08/09) or special (1-700, 1-800, 1-801, 1-599); null = not valid. */
export function phoneKind(raw: unknown): PhoneKind | null {
  const n = normalizeIlPhone(raw);
  return n ? phoneKindOfNational(n) : null;
}

export const isValidIlPhone = (raw: unknown): boolean => normalizeIlPhone(raw) !== null;

// ─── Email ────────────────────────────────────────────────────────────────────

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function isValidEmail(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const s = raw.trim();
  if (!s || s.length > PAGE_INPUT_LIMITS.email) return false;
  if (!EMAIL.test(s)) return false;
  const [local] = s.split('@');
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !s.includes('..');
}

// ─── Links ────────────────────────────────────────────────────────────────────

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// "www.facebook.com/foo", "instagram.com/foo": a bare host typed without https://.
const BARE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]|$)/i;

/**
 * The canonical absolute http(s) URL, or null. Same contract as src/utils/safeUrl.ts parseHttpUrl with
 * allowBare: no other scheme (javascript:, data:), no whitespace or quotes, no credentials, a real
 * dotted host. A scheme-less "facebook.com/x" becomes https://facebook.com/x.
 */
export function canonicalHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || s.length > PAGE_INPUT_LIMITS.external_link) return null;
  if (/[\s\u0000-\u001f\u007f\u2028\u2029<>"'`\\]/.test(s)) return null;
  if (s.startsWith('//')) return null;
  if (!HAS_SCHEME.test(s)) {
    if (!BARE_HOST.test(s)) return null;
    s = `https://${s}`;
  }
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || u.username || u.password) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/i.test(u.hostname)) return null;
  return u.href;
}

const hostIs = (host: string, domains: readonly string[]) =>
  domains.some((d) => host === d || host.endsWith(`.${d}`));

const FACEBOOK_HOSTS = ['facebook.com', 'fb.com', 'fb.me'] as const;
const INSTAGRAM_HOSTS = ['instagram.com', 'instagr.am'] as const;

/**
 * One link field. Empty = { ok: true, value: null }. facebook_url must point at facebook.com (or fb.com /
 * fb.me) and instagram_url at instagram.com, each with a page path, not the bare home page.
 */
export function checkLink(field: LinkField, raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: INPUT_MESSAGES[field] };
  if (!raw.trim()) return { ok: true, value: null };
  const href = canonicalHttpUrl(raw);
  if (!href) return { ok: false, error: INPUT_MESSAGES[field] };
  if (field === 'external_link') return { ok: true, value: href };
  const u = new URL(href);
  const host = u.hostname.toLowerCase();
  const domains = field === 'facebook_url' ? FACEBOOK_HOSTS : INSTAGRAM_HOSTS;
  const hasPage = u.pathname.replace(/\/+$/, '') !== '' || u.search !== '';
  if (!hostIs(host, domains) || !hasPage) return { ok: false, error: INPUT_MESSAGES[field] };
  return { ok: true, value: href };
}

// ─── One field ────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const CONTROL_ANY = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface FieldOptions {
  required?: boolean;
  /** Overrides the field's limit (the server's combined free text). */
  max?: number;
}

/** The error message for one field, or null when it is fine. Empty optional fields are fine. */
export function fieldError(field: PageInputField, raw: unknown, opts: FieldOptions = {}): string | null {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return INPUT_MESSAGES.badChars;
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return opts.required ? INPUT_MESSAGES.required : null;
  const max = opts.max ?? PAGE_INPUT_LIMITS[field];
  // A phone number says what a phone number looks like, also when it is too long.
  if (field === 'phone_number') return isValidIlPhone(s) ? null : INPUT_MESSAGES.phone;
  if (field === 'facebook_url' || field === 'instagram_url' || field === 'external_link') {
    if (s.length > max) return INPUT_MESSAGES.tooLong(max, s.length);
    const r = checkLink(field, s);
    return r.ok ? null : r.error;
  }
  if (s.length > max) return INPUT_MESSAGES.tooLong(max, s.length);
  if (CONTROL_ANY.test(s)) return INPUT_MESSAGES.badChars;
  if (!MULTILINE.has(field) && /[\r\n\u2028\u2029]/.test(s)) return INPUT_MESSAGES.oneLine;
  if (field === 'email') return isValidEmail(s) ? null : INPUT_MESSAGES.email;
  return null;
}

// ─── The whole form ───────────────────────────────────────────────────────────

export interface PageInputDraft {
  business_name?: unknown;
  vibe?: unknown;
  phone_number?: unknown;
  email?: unknown;
  address?: unknown;
  business_hours?: unknown;
  facebook_url?: unknown;
  instagram_url?: unknown;
  external_link?: unknown;
  user_provided_text?: unknown;
  about_business?: unknown;
  testimonial_quote?: unknown;
  testimonial_author?: unknown;
  cta_type?: unknown;
}

export type FieldErrors = Partial<Record<PageInputField, string>>;

export interface PageInputResult {
  ok: boolean;
  errors: FieldErrors;
  /** Canonical links (https://...) or null, valid only when ok. */
  links: Record<LinkField, string | null>;
}

const REQUIRED: readonly PageInputField[] = ['business_name', 'vibe', 'phone_number'];
const CHECKED: readonly PageInputField[] = [
  'business_name', 'vibe', 'phone_number', 'email', 'address', 'business_hours',
  'facebook_url', 'instagram_url', 'external_link',
  'user_provided_text', 'about_business', 'testimonial_quote', 'testimonial_author',
];

/**
 * Checks a whole page request. `combinedUserText` (the server) measures user_provided_text against
 * USER_TEXT_COMBINED_MAX, because the wizard has already merged the follow-up answers into it.
 */
export function validatePageInput(input: PageInputDraft, opts: { combinedUserText?: boolean } = {}): PageInputResult {
  const errors: FieldErrors = {};
  for (const f of CHECKED) {
    const raw = (input as Record<string, unknown>)[f];
    const max = f === 'user_provided_text' && opts.combinedUserText ? USER_TEXT_COMBINED_MAX : undefined;
    const e = fieldError(f, raw, { required: REQUIRED.includes(f), max });
    if (e) errors[f] = e;
  }
  const blank = (v: unknown) => typeof v !== 'string' || !v.trim();
  if (input.cta_type === 'link' && blank(input.external_link) && !errors.external_link) {
    errors.external_link = INPUT_MESSAGES.linkRequired;
  }
  const link = (f: LinkField) => {
    const r = checkLink(f, (input as Record<string, unknown>)[f]);
    return r.ok ? r.value : null;
  };
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    links: { facebook_url: link('facebook_url'), instagram_url: link('instagram_url'), external_link: link('external_link') },
  };
}

/** Wizard counter text: "120/3000". */
export const counterText = (value: string, field: PageInputField): string =>
  `${value.trim().length}/${PAGE_INPUT_LIMITS[field]}`;
