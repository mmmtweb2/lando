// Read-only diagnosis of the Google Business Profile connection (admin tool, task "GBP diagnosis").
// Walks the same calls the product makes, in order, and reports for every step the HTTP status and Google's
// own error (status, message, reasons, quota details), so "approved but quota 0" can be settled with facts.
//   Steps: config -> connection -> token -> accounts -> locations -> location read -> performance -> reviews.
// Only GET requests (plus the token refresh). Nothing is written to Google. Access/refresh tokens, client
// secret and the Authorization header never enter the report; success bodies are reduced to counts.

import { gbpOAuthConfig, gbpConnectEnabled } from '../config/gbp';
import { decryptToken } from './gbpCrypto';
import { getConnection, markNeedsReconnect } from './gbpStore';
import { dateRange, type Fetch } from './gbpGoogle';

export type StepKey = 'config' | 'connection' | 'token' | 'accounts' | 'locations' | 'location' | 'performance' | 'reviews';
export interface Step {
  key: StepKey; label: string; ok: boolean; skipped?: boolean;
  httpStatus?: number; googleStatus?: string; message?: string; reasons?: string[]; quota?: string[]; detail?: string; api?: string;
  /** Google answered fine but the list was empty (no accounts / no cards): not a pass. */
  empty?: boolean;
}
export type Verdict = 'works' | 'quota' | 'api_disabled' | 'permission' | 'reconnect' | 'not_connected' | 'config' | 'no_locations' | 'unknown';
export interface Diagnosis { at: string; email: string; verdict: Verdict; summary: string; steps: Step[]; project: string | null }

const LABEL: Record<StepKey, string> = {
  config: 'הגדרות החיבור בשרת', connection: 'חיבור שמור לחשבון', token: 'חידוש טוקן גישה', accounts: 'רשימת חשבונות (Account Management)',
  locations: 'רשימת מיקומים (Business Information)', location: 'קריאת מיקום (Business Information)', performance: 'מדדי ביצועים (Performance)', reviews: 'רשימת ביקורות (My Business v4)',
};
const API: Partial<Record<StepKey, string>> = {
  accounts: 'mybusinessaccountmanagement.googleapis.com', locations: 'mybusinessbusinessinformation.googleapis.com',
  location: 'mybusinessbusinessinformation.googleapis.com', performance: 'businessprofileperformance.googleapis.com', reviews: 'mybusiness.googleapis.com',
};

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

/** Google's error body, reduced to what an operator needs. Never contains credentials. */
export function readGoogleError(body: unknown): { googleStatus?: string; message?: string; reasons: string[]; quota: string[]; project?: string } {
  const e = ((body ?? {}) as { error?: { status?: string; message?: string; details?: unknown[] } }).error ?? {};
  const reasons: string[] = []; const quota: string[] = []; let project: string | undefined;
  for (const d of (Array.isArray(e.details) ? e.details : []) as Record<string, unknown>[]) {
    if (typeof d?.reason === 'string') reasons.push(d.reason);
    const md = (d?.metadata ?? {}) as Record<string, unknown>;
    for (const k of ['quota_metric', 'quota_limit', 'quota_limit_value', 'service', 'consumer', 'quota_location']) if (md[k] !== undefined) quota.push(`${k}=${clip(md[k], 120)}`);
    if (typeof md.consumer === 'string') project = (md.consumer as string).replace(/^projects\//, '');
    if (typeof md.containerInfo === 'string') project = project ?? md.containerInfo;
    for (const v of (Array.isArray(d?.violations) ? d.violations : []) as Record<string, unknown>[]) if (typeof v?.description === 'string') quota.push(clip(v.description, 160));
  }
  return { googleStatus: typeof e.status === 'string' ? e.status : undefined, message: e.message ? clip(e.message, 500) : undefined, reasons: [...new Set(reasons)].slice(0, 6), quota: [...new Set(quota)].slice(0, 8), project };
}

export function verdictOf(steps: Step[]): { verdict: Verdict; summary: string } {
  const bad = steps.find((s) => !s.ok && !s.skipped);
  if (!bad) return { verdict: 'works', summary: 'כל השלבים עברו. הגישה ל-Business Profile עובדת עם החשבון הזה.' };
  if (bad.empty) {
    return {
      verdict: 'no_locations',
      summary: bad.key === 'accounts'
        ? 'החיבור תקין, אבל בחשבון הגוגל שהתחבר אין שום חשבון Business Profile. מתחברים עם חשבון הגוגל שמנהל את הכרטיס.'
        : 'החיבור תקין, אבל אף כרטיס לא מופיע ברשימה של חשבון הגוגל שהתחבר. אם זה מנהל ולא בעלים: בעל הכרטיס צריך להוסיף את המייל כמנהל, והמנהל צריך לאשר את ההזמנה (גם במייל וגם בפרופיל העסק בגוגל), ואז לחבר מחדש.',
    };
  }
  const txt = `${bad.googleStatus ?? ''} ${bad.reasons?.join(' ') ?? ''} ${bad.message ?? ''}`;
  if (bad.key === 'config') return { verdict: 'config', summary: 'הגדרות החיבור בשרת חסרות או כבויות (GBP_CONNECT_ENABLED, מפתח הצפנה, Client ID/Secret, כתובת חזרה).' };
  if (bad.key === 'connection') return { verdict: 'not_connected', summary: 'החשבון הזה לא מחובר לגוגל. מתחברים מתוך הדשבורד ואז מריצים שוב.' };
  if (bad.key === 'token' || bad.httpStatus === 401) return { verdict: 'reconnect', summary: 'הטוקן נדחה (בוטל או פג, ובמצב Testing הוא פג אחרי 7 ימים). צריך להתחבר מחדש.' };
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(txt)) return { verdict: 'api_disabled', summary: `הממשק ${bad.api ?? ''} לא מופעל בפרויקט. מפעילים אותו ב-Cloud Console ← APIs & Services ← Library.` };
  if (bad.httpStatus === 429 || /RESOURCE_EXHAUSTED|quota/i.test(txt)) return { verdict: 'quota', summary: `גוגל מחזירה מכסה מוגמרת או 0 עבור ${bad.api ?? 'הממשק'} (השלב: ${bad.label}). הפרטים המלאים למטה: מספר הפרויקט והמדד.` };
  if (bad.httpStatus === 403) return { verdict: 'permission', summary: 'גוגל מסרבת (403) למרות שהממשק מופעל: ייתכן שאין לחשבון הרשאת ניהול בכרטיס, או שהפרויקט לא אושר לממשק הזה.' };
  return { verdict: 'unknown', summary: `השלב "${bad.label}" נכשל. ראו את ההודעה המלאה למטה.` };
}

async function probe(key: StepKey, url: string, access: string, f: Fetch): Promise<{ step: Step; body: Record<string, any> | null; project?: string }> {
  const base: Step = { key, label: LABEL[key], ok: false, api: API[key] };
  try {
    const r = await f(url, { headers: { authorization: `Bearer ${access}` } });
    const body = (await r.json().catch(() => ({}))) as Record<string, any>;
    if (r.ok) return { step: { ...base, ok: true, httpStatus: r.status }, body };
    const g = readGoogleError(body);
    return { step: { ...base, httpStatus: r.status, googleStatus: g.googleStatus, message: g.message, reasons: g.reasons, quota: g.quota }, body: null, project: g.project };
  } catch (e) {
    return { step: { ...base, message: `network:${clip(e instanceof Error ? e.name : e, 60)}` }, body: null };
  }
}

const skipped = (key: StepKey, why: string): Step => ({ key, label: LABEL[key], ok: false, skipped: true, detail: why });

export async function runDiagnosis(email: string, f: Fetch = fetch, now = new Date()): Promise<Diagnosis> {
  const steps: Step[] = [];
  let project: string | null = null;
  const finish = (): Diagnosis => { const v = verdictOf(steps); return { at: now.toISOString(), email, ...v, steps, project }; };
  const rest = (from: StepKey[], why: string) => { for (const k of from) steps.push(skipped(k, why)); };
  const ALL: StepKey[] = ['token', 'accounts', 'locations', 'location', 'performance', 'reviews'];

  const cfg = gbpOAuthConfig();
  if (!cfg) {
    steps.push({ key: 'config', label: LABEL.config, ok: false, detail: gbpConnectEnabled() ? 'ההגדרות חלקיות (מפתח הצפנה, Client ID/Secret או כתובת חזרה)' : 'GBP_CONNECT_ENABLED אינו true' });
    rest(['connection', ...ALL], 'לא נבדק');
    return finish();
  }
  steps.push({ key: 'config', label: LABEL.config, ok: true, detail: `Client ID מתחיל ב-${cfg.clientId.slice(0, 12)}…` });
  project = /^(\d{6,})-/.exec(cfg.clientId)?.[1] ?? null;

  let conn;
  try { conn = await getConnection(email); } catch (e) { conn = null; steps.push({ key: 'connection', label: LABEL.connection, ok: false, message: `store:${clip(e instanceof Error ? e.message : e, 80)}` }); rest(ALL, 'לא נבדק'); return finish(); }
  if (!conn) { steps.push({ key: 'connection', label: LABEL.connection, ok: false, detail: 'אין חיבור שמור לחשבון הזה' }); rest(ALL, 'לא נבדק'); return finish(); }
  steps.push({ key: 'connection', label: LABEL.connection, ok: true, detail: conn.status === 'needs_reconnect' ? 'סטטוס שמור: דורש חיבור מחדש' : 'סטטוס שמור: פעיל' });

  const refresh = decryptToken(conn.refresh_token_enc, cfg.key);
  if (!refresh) { steps.push({ key: 'token', label: LABEL.token, ok: false, httpStatus: 401, detail: 'לא ניתן לפענח את הטוקן השמור (מפתח הצפנה שונה?)' }); rest(ALL.slice(1), 'לא נבדק'); return finish(); }
  let access = '';
  try {
    const r = await f('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: refresh, client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'refresh_token' }).toString(),
    });
    const b = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || typeof b.access_token !== 'string') {
      steps.push({ key: 'token', label: LABEL.token, ok: false, httpStatus: r.status, googleStatus: clip(b.error, 60), message: clip(b.error_description, 200) });
      if (b.error === 'invalid_grant') await markNeedsReconnect(email, 'revoked').catch(() => undefined);
      rest(ALL.slice(1), 'לא נבדק');
      return finish();
    }
    access = b.access_token;
    steps.push({ key: 'token', label: LABEL.token, ok: true, httpStatus: r.status });
  } catch (e) { steps.push({ key: 'token', label: LABEL.token, ok: false, message: `network:${clip(e instanceof Error ? e.name : e, 60)}` }); rest(ALL.slice(1), 'לא נבדק'); return finish(); }

  const take = (p: Awaited<ReturnType<typeof probe>>) => { steps.push(p.step); if (p.project) project = p.project; return p; };

  const acc = take(await probe('accounts', 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20', access, f));
  // Same walk as the product (listLocations): every account the Google user owns OR manages, first 5.
  const accountRows = ((acc.body?.accounts ?? []) as { name?: string; type?: string; role?: string }[])
    .filter((a): a is { name: string; type?: string; role?: string } => !!a.name && /^accounts\/[\w-]+$/.test(a.name)).slice(0, 5);
  if (acc.step.ok) {
    // Types and roles are Google enum names (PERSONAL, LOCATION_GROUP, PRIMARY_OWNER, SITE_MANAGER...): no personal data.
    acc.step.detail = `${accountRows.length} חשבונות` + (accountRows.length ? ` (${accountRows.map((a) => `${clip(a.type ?? '?', 20)}/${clip(a.role ?? '?', 20)}`).join(', ')})` : '');
    if (!accountRows.length) acc.step.ok = false, acc.step.empty = true;
  }
  if (!acc.step.ok) { rest(['locations', 'location', 'performance', 'reviews'], 'תלוי בשלב קודם שנכשל'); return finish(); }

  const found: { name: string; account: string }[] = [];
  const perAccount: number[] = [];
  let locFail: ReturnType<typeof take> | null = null;
  for (const a of accountRows) {
    const loc = await probe('locations', `https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,metadata&pageSize=100`, access, f);
    if (!loc.step.ok) { locFail = take(loc); break; }
    const names = ((loc.body?.locations ?? []) as { name?: string }[]).map((l) => l.name).filter((n): n is string => !!n && /^locations\/[\w-]+$/.test(n));
    perAccount.push(names.length);
    for (const n of names) found.push({ name: n, account: a.name });
  }
  if (locFail) { rest(['location', 'performance', 'reviews'], 'תלוי בשלב קודם שנכשל'); return finish(); }
  const locStep: Step = { key: 'locations', label: LABEL.locations, ok: found.length > 0, httpStatus: 200, api: API.locations,
    detail: `${found.length} מיקומים (לפי חשבון: ${perAccount.join(', ')})`, ...(found.length ? {} : { empty: true }) };
  steps.push(locStep);
  if (!found.length) { rest(['location', 'performance', 'reviews'], 'תלוי בשלב קודם שנכשל'); return finish(); }
  const chosen = found.find((l) => l.name === conn.location_name) ?? found[0];
  const place = chosen.name;
  const accountOfPlace = chosen.account;

  const one = take(await probe('location', `https://mybusinessbusinessinformation.googleapis.com/v1/${place}?readMask=name,title,phoneNumbers,regularHours,categories`, access, f));
  if (one.step.ok) one.step.detail = 'קריאה הצליחה';

  const { start, end } = dateRange(now, 7);
  const q = new URLSearchParams(); q.append('dailyMetrics', 'CALL_CLICKS');
  q.set('dailyRange.start_date.year', String(start.y)); q.set('dailyRange.start_date.month', String(start.m)); q.set('dailyRange.start_date.day', String(start.d));
  q.set('dailyRange.end_date.year', String(end.y)); q.set('dailyRange.end_date.month', String(end.m)); q.set('dailyRange.end_date.day', String(end.d));
  const perf = take(await probe('performance', `https://businessprofileperformance.googleapis.com/v1/${place}:fetchMultiDailyMetricsTimeSeries?${q.toString()}`, access, f));
  if (perf.step.ok) perf.step.detail = 'קריאה הצליחה';

  const rev = take(await probe('reviews', `https://mybusiness.googleapis.com/v4/${accountOfPlace}/${place}/reviews?pageSize=1`, access, f));
  if (rev.step.ok) rev.step.detail = `${Array.isArray(rev.body?.reviews) ? rev.body!.reviews.length : 0} ביקורות בדגימה`;
  return finish();
}

// One run at a time and at most one per 10 seconds: a diagnosis spends real API quota.
let last = 0;
export function allowRun(nowMs = Date.now()): boolean { if (nowMs - last < 10000) return false; last = nowMs; return true; }
export function resetRunGuard(): void { last = 0; }
