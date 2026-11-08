// Dashboard v3 is opt-in: ?dash=v3 turns it on and the choice is remembered in this browser (the
// same key and pattern as ../flag.ts). ?dash=v2 or ?dash=v1 turn it off again. The default stays
// v2 until Moshe approves after QA. Reading storage can throw, so every access is guarded.
const KEY = 'pagey_dash';

export function dashV3Enabled(): boolean {
  let q: string | null = null;
  try { q = new URLSearchParams(window.location.search).get('dash'); } catch { /* no query */ }
  if (q === 'v3') {
    try { window.localStorage.setItem(KEY, 'v3'); } catch { /* not remembered */ }
    return true;
  }
  if (q === 'v2' || q === 'v1') return false;   // ../flag.ts stores these
  try { return window.localStorage.getItem(KEY) === 'v3'; } catch { return false; }
}
