// Google Business Profile connection (Stage 6.3) — configuration only.
//
// The product will let a customer connect their Google account so Pagey can read the
// "calls / directions / website clicks / searches" numbers of their Business Profile.
// Nothing in this file talks to Google; it only reads the environment and tells the
// operator (Moshe) whether the values he pasted into Coolify are well-formed, WITHOUT ever
// returning a secret.
//
//   GOOGLE_OAUTH_CLIENT_ID       OAuth client ID  (Google Cloud → Credentials → Web application)
//   GOOGLE_OAUTH_CLIENT_SECRET   its secret
//   GBP_TOKEN_ENCRYPTION_KEY     64 hex characters (32 random bytes); encrypts customers'
//                                refresh tokens in the database. Losing or changing it makes
//                                every stored connection unreadable (customers reconnect).
//   GBP_OAUTH_REDIRECT_URI       optional override; default PUBLIC_API_URL + GBP_CALLBACK_PATH
//
// The redirect URI must match, character for character, what is registered on the OAuth client
// in Google Cloud. A mismatch shows the customer "Error 400: redirect_uri_mismatch".

export const GBP_OAUTH_SCOPE = 'https://www.googleapis.com/auth/business.manage';
export const GBP_CALLBACK_PATH = '/api/seo/gbp/oauth/callback';

export type CheckLevel = 'ok' | 'warn' | 'missing' | 'bad';
export interface ConfigCheck { key: string; level: CheckLevel; message: string; }
export interface GbpConfigStatus {
  checks: ConfigCheck[];
  redirectUri: string | null;
  /** true when every check is ok or only a warning. */
  ready: boolean;
}

type Env = Record<string, string | undefined>;

/** Problems an operator typically introduces when pasting into a dashboard. */
function pasteProblem(v: string): string | null {
  if (v !== v.trim()) return 'יש רווח או ירידת שורה בתחילת הערך או בסופו. למחוק ולהדביק מחדש.';
  if (/^["'`].*["'`]$/.test(v)) return 'הערך עטוף במירכאות. להכניס אותו בלי מירכאות.';
  if (/\s/.test(v)) return 'יש רווח באמצע הערך.';
  return null;
}

export function gbpRedirectUri(env: Env = process.env): string | null {
  const override = env.GBP_OAUTH_REDIRECT_URI;
  if (override && override.trim()) return override.trim();
  const base = env.PUBLIC_API_URL;
  if (!base || !base.trim()) return null;
  return base.trim().replace(/\/+$/, '') + GBP_CALLBACK_PATH;
}

/** The 32-byte key, or null when missing / not exactly 64 hex characters. */
export function gbpEncryptionKey(env: Env = process.env): Buffer | null {
  const v = env.GBP_TOKEN_ENCRYPTION_KEY;
  if (!v || !/^[0-9a-fA-F]{64}$/.test(v)) return null;
  return Buffer.from(v, 'hex');
}

export function gbpConfigStatus(env: Env = process.env): GbpConfigStatus {
  const checks: ConfigCheck[] = [];

  // 1. Client ID (not secret: the beginning is shown so it can be matched to the console).
  const id = env.GOOGLE_OAUTH_CLIENT_ID;
  if (!id) {
    checks.push({ key: 'GOOGLE_OAUTH_CLIENT_ID', level: 'missing', message: 'לא הוגדר.' });
  } else if (pasteProblem(id)) {
    checks.push({ key: 'GOOGLE_OAUTH_CLIENT_ID', level: 'bad', message: pasteProblem(id)! });
  } else if (!id.endsWith('.apps.googleusercontent.com')) {
    checks.push({ key: 'GOOGLE_OAUTH_CLIENT_ID', level: 'bad', message: 'לא נראה כמו Client ID של Google. הוא אמור להסתיים ב-.apps.googleusercontent.com.' });
  } else {
    checks.push({ key: 'GOOGLE_OAUTH_CLIENT_ID', level: 'ok', message: `הוגדר. מתחיל ב-${id.slice(0, 12)}…` });
  }

  // 2. Client secret (never echoed).
  const secret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!secret) {
    checks.push({ key: 'GOOGLE_OAUTH_CLIENT_SECRET', level: 'missing', message: 'לא הוגדר.' });
  } else if (pasteProblem(secret)) {
    checks.push({ key: 'GOOGLE_OAUTH_CLIENT_SECRET', level: 'bad', message: pasteProblem(secret)! });
  } else if (!secret.startsWith('GOCSPX-')) {
    checks.push({ key: 'GOOGLE_OAUTH_CLIENT_SECRET', level: 'warn', message: 'הוגדר, אבל Secret של Google בדרך כלל מתחיל ב-GOCSPX-. כדאי לוודא שהועתק נכון.' });
  } else {
    checks.push({ key: 'GOOGLE_OAUTH_CLIENT_SECRET', level: 'ok', message: 'הוגדר.' });
  }

  // 3. Token encryption key.
  const key = env.GBP_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    checks.push({ key: 'GBP_TOKEN_ENCRYPTION_KEY', level: 'missing', message: 'לא הוגדר.' });
  } else if (pasteProblem(key)) {
    checks.push({ key: 'GBP_TOKEN_ENCRYPTION_KEY', level: 'bad', message: pasteProblem(key)! });
  } else if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    checks.push({
      key: 'GBP_TOKEN_ENCRYPTION_KEY', level: 'bad',
      message: `חייב להיות בדיוק 64 תווים של 0-9 ו-a-f. כרגע ${key.length} תווים${/^[0-9a-fA-F]+$/.test(key) ? '' : ' ויש בו תווים אחרים'}.`,
    });
  } else {
    checks.push({ key: 'GBP_TOKEN_ENCRYPTION_KEY', level: 'ok', message: 'הוגדר ותקין (64 תווים).' });
  }

  // 4. Redirect URI (shown in full: it is not secret and must be compared by eye with Google Cloud).
  const redirect = gbpRedirectUri(env);
  if (!redirect) {
    checks.push({ key: 'redirect URI', level: 'missing', message: 'אין PUBLIC_API_URL, ולכן אי אפשר לחשב כתובת חזרה.' });
  } else {
    let problem: string | null = null;
    try {
      const u = new URL(redirect);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.protocol !== 'https:' && !local) problem = 'חייב להתחיל ב-https://.';
      else if (u.search || u.hash) problem = 'לא יכול להכיל סימן שאלה או #.';
      else if (u.pathname !== GBP_CALLBACK_PATH) problem = `הנתיב חייב להסתיים ב-${GBP_CALLBACK_PATH}.`;
    } catch {
      problem = 'לא כתובת תקינה.';
    }
    checks.push(problem
      ? { key: 'redirect URI', level: 'bad', message: problem }
      : { key: 'redirect URI', level: 'ok', message: 'כתובת החזרה תקינה. להשוות אות באות למה שהוזן ב-Google Cloud.' });
  }

  return { checks, redirectUri: redirect, ready: checks.every((c) => c.level === 'ok' || c.level === 'warn') };
}
