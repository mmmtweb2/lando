// Dashboard v2 switch. Existing customers see NOTHING different until Moshe decides:
//   - an admin account gets v2 by default
//   - anyone else opts in with ?dash=v2 (remembered in this browser); ?dash=v1 turns it off again
// Reading storage can throw (private windows, blocked cookies), so every access is guarded.
const KEY = 'pagey_dash';

export function dashV2Enabled(isAdmin: boolean): boolean {
  let q: string | null = null;
  try { q = new URLSearchParams(window.location.search).get('dash'); } catch { /* no query */ }
  if (q === 'v2' || q === 'v1') {
    try { window.localStorage.setItem(KEY, q); } catch { /* not remembered */ }
    return q === 'v2';
  }
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'v2' || saved === 'v1') return saved === 'v2';
  } catch { /* fall through */ }
  return isAdmin;
}
