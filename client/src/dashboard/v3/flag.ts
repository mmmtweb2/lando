// Dashboard v3 is the default for every account (decision of 2026-11-08, after the stage-1/2 review).
// The older dashboards stay as escape hatches in this browser: ?dash=v2 or ?dash=v1 switch to them
// (../flag.ts remembers the choice under the same key), ?dash=v3 switches back. Reading storage can
// throw, so every access is guarded, and a failed read means "default", which is v3.
const KEY = 'pagey_dash';

export function dashV3Enabled(): boolean {
  let q: string | null = null;
  try { q = new URLSearchParams(window.location.search).get('dash'); } catch { /* no query */ }
  if (q === 'v3') {
    try { window.localStorage.setItem(KEY, 'v3'); } catch { /* not remembered */ }
    return true;
  }
  if (q === 'v2' || q === 'v1') return false;   // ../flag.ts stores these
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'v2' || stored === 'v1') return false;
  } catch { /* fall through to the default */ }
  return true;
}
