// ─────────────────────────────────────────────────────────────────────────────
// subdomain.service.ts — readable per-page subdomains (cafe-dani.pagey.co.il).
//
//   • assignSubdomain(): picks a name for a published page. An LLM turns the
//     Hebrew business name into a short English slug; a built-in Hebrew→Latin
//     transliteration is the fallback (no API key / failure / timeout).
//     Collisions get a numeric suffix. Race-safe via the partial unique index
//     from migrations/024_page_subdomain.sql.
//   • subdomainFromHost(): maps a request Host header to a candidate subdomain.
//   • backfillSubdomains(): gives already-published pages a subdomain (sweep).
//
// /p/<slug> keeps working for every page, forever — the subdomain is additive.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../config/supabase';

export const ROOT_DOMAIN = (process.env.ROOT_DOMAIN || 'pagey.co.il').toLowerCase();

/** Names that must never be handed to a customer page (infra / brand / abuse). */
export const RESERVED_SUBDOMAINS = new Set([
  'www', 'api', 'app', 'admin', 'administrator', 'root', 'mail', 'email', 'smtp', 'imap', 'pop', 'pop3',
  'webmail', 'mx', 'ns', 'ns1', 'ns2', 'ftp', 'sftp', 'ssh', 'vpn', 'cdn', 'static', 'assets', 'img',
  'images', 'media', 'files', 'upload', 'uploads', 'download', 'blog', 'help', 'support', 'status', 'docs',
  'dashboard', 'login', 'signin', 'signup', 'register', 'auth', 'account', 'accounts', 'billing', 'pay',
  'payment', 'payments', 'checkout', 'invoice', 'test', 'testing', 'dev', 'staging', 'stage', 'prod',
  'demo', 'preview', 'beta', 'p', 'page', 'pages', 'landing', 'site', 'sites', 'web', 'pagey', 'lando',
  'buildy', 'autodiscover', 'autoconfig', 'cpanel', 'whm', 'secure', 'ssl', 'git', 'coolify', 'traefik',
  'sumit', 'resend', 'supabase', 'cloudflare', 'google', 'facebook', 'instagram', 'whatsapp', 'null',
  'undefined', 'localhost', 'info', 'contact', 'sales', 'office', 'abuse', 'security', 'privacy', 'terms',
]);

const SUB_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const MAX_BASE_LEN = 30;
const MIN_BASE_LEN = 3;

export function isUsableSubdomain(s: string): boolean {
  return SUB_RE.test(s) && !RESERVED_SUBDOMAINS.has(s);
}

/** Request Host → subdomain label, or null for the apex / www / reserved / non-pagey hosts. */
export function subdomainFromHost(hostname: string | undefined): string | null {
  if (!hostname) return null;
  const host = hostname.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const suffix = `.${ROOT_DOMAIN}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  return isUsableSubdomain(label) ? label : null;
}

export function publicPageUrl(slug: string, subdomain?: string | null): string {
  return subdomain ? `https://${subdomain}.${ROOT_DOMAIN}` : `https://${ROOT_DOMAIN}/p/${slug}`;
}

// ─── Name generation ─────────────────────────────────────────────────────────

const HEB: Record<string, string> = {
  א: 'a', ב: 'b', ג: 'g', ד: 'd', ה: 'h', ו: 'v', ז: 'z', ח: 'h', ט: 't', י: 'y', כ: 'k', ך: 'k',
  ל: 'l', מ: 'm', ם: 'm', נ: 'n', ן: 'n', ס: 's', ע: 'a', פ: 'p', ף: 'f', צ: 'tz', ץ: 'tz', ק: 'k',
  ר: 'r', ש: 'sh', ת: 't',
};

function transliterate(name: string): string {
  return name.replace(/[֐-׿]/g, (ch) => HEB[ch] ?? '');
}

export function slugifyBase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LEN)
    .replace(/-+$/g, '');
}

async function aiBase(businessName: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const r = await client.messages.create(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 30,
        system:
          'You turn an Israeli business name (usually Hebrew) into a short, readable English subdomain label. ' +
          'Rules: lowercase a-z, digits and hyphens only; 3-24 characters; translate or transliterate the name ' +
          '(e.g. "קפה דני" -> "cafe-dani", "מאפיית לחם הארץ" -> "lechem-haaretz-bakery"); no brand names you invent; ' +
          'reply with ONLY the label, nothing else.',
        messages: [{ role: 'user', content: businessName.slice(0, 80) }],
      },
      { timeout: 3500 },
    );
    const text = r.content[0]?.type === 'text' ? r.content[0].text.trim() : '';
    const slug = slugifyBase(text);
    return slug.length >= MIN_BASE_LEN ? slug : null;
  } catch (err) {
    console.warn('[SUBDOMAIN] AI naming failed — falling back to transliteration:', err instanceof Error ? err.message : err);
    return null;
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

async function pickBase(businessName: string): Promise<string> {
  const fromAi = await aiBase(businessName);
  if (fromAi && isUsableSubdomain(fromAi)) return fromAi;
  const fromTranslit = slugifyBase(transliterate(businessName));
  if (fromTranslit.length >= MIN_BASE_LEN && isUsableSubdomain(fromTranslit)) return fromTranslit;
  return `page-${randomSuffix()}`;
}

/**
 * Give a page a subdomain if it has none. Idempotent and race-safe; returns the
 * page's subdomain (existing or new), or null if it could not be assigned.
 * Never throws — callers treat this as best-effort.
 */
export async function assignSubdomain(pageId: string, businessName: string | null): Promise<string | null> {
  try {
    const { data: row, error } = await supabase
      .from('landing_pages')
      .select('subdomain')
      .eq('id', pageId)
      .single();
    if (error || !row) return null;
    const existing = (row as { subdomain?: string | null }).subdomain;
    if (existing) return existing;

    const base = await pickBase(businessName?.trim() || 'page');
    const candidates = [base, ...[2, 3, 4, 5, 6].map((n) => `${base}-${n}`), `${base}-${randomSuffix()}`, `page-${randomSuffix()}${randomSuffix()}`];

    for (const candidate of candidates) {
      if (!isUsableSubdomain(candidate)) continue;
      const { data, error: upErr } = await supabase
        .from('landing_pages')
        .update({ subdomain: candidate })
        .eq('id', pageId)
        .is('subdomain', null)
        .select('subdomain')
        .maybeSingle();

      if (!upErr) {
        // data null = lost a race to another assigner of THIS page; re-read.
        if (data) return (data as { subdomain: string }).subdomain;
        const { data: again } = await supabase.from('landing_pages').select('subdomain').eq('id', pageId).single();
        return (again as { subdomain?: string | null } | null)?.subdomain ?? null;
      }
      if (upErr.code !== '23505') {
        console.error('[SUBDOMAIN] assign failed', { pageId, error: upErr.message });
        return null;
      }
      // 23505 = unique violation → name taken, try the next candidate.
    }
    return null;
  } catch (err) {
    console.error('[SUBDOMAIN] assign threw', { pageId, err });
    return null;
  }
}

export async function getPageBySubdomain(subdomain: string): Promise<{ slug: string } | null> {
  const { data, error } = await supabase
    .from('landing_pages')
    .select('slug')
    .eq('subdomain', subdomain)
    .maybeSingle();
  if (error || !data) return null;
  return data as { slug: string };
}

/** Sweep stage: published pages that predate this feature get a subdomain. */
export async function backfillSubdomains(limit = 40): Promise<number> {
  const { data, error } = await supabase
    .from('landing_pages')
    .select('id, business_name')
    .eq('status', 'published')
    .is('subdomain', null)
    .limit(limit);
  if (error) {
    console.error('[SUBDOMAIN] backfill query failed:', error.message);
    return 0;
  }
  let done = 0;
  for (const row of (data ?? []) as { id: string; business_name: string | null }[]) {
    const sub = await assignSubdomain(row.id, row.business_name);
    if (sub) done++;
  }
  if (done) console.log('[SUBDOMAIN] backfilled', done, 'pages');
  return done;
}
