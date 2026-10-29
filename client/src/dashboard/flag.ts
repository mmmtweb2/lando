// Dashboard v2 is the default for every account. The old dashboard stays available for now as an
// escape hatch: ?dash=v1 switches to it (remembered in this browser), ?dash=v2 switches back.
// Reading storage can throw (private windows, blocked cookies), so every access is guarded.
const KEY = 'pagey_dash';

export function dashV2Enabled(_isAdmin: boolean): boolean {
  let q: string | null = null;
  try { q = new URLSearchParams(window.location.search).get('dash'); } catch { /* no query */ }
  if (q === 'v2' || q === 'v1') {
    try { window.localStorage.setItem(KEY, q); } catch { /* not remembered */ }
    return q === 'v2';
  }
  try {
    if (window.localStorage.getItem(KEY) === 'v1') return false;
  } catch { /* fall through */ }
  return true;
}
