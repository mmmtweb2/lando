// Whole-product design v3 ("סגנון מובלט") is opt-in while it is rolled out screen by screen:
// ?ui=v3 turns it on and the choice is remembered in this browser; ?ui=v2 (or ?ui=off) turns it off.
// The default stays the current design until Moshe approves after QA. Reading storage can throw,
// so every access is guarded. The dashboard keeps its own flag (?dash=v3, dashboard/v3/flag.ts).
const KEY = 'pagey_ui';

export function uiV3Enabled(): boolean {
  let q: string | null = null;
  try { q = new URLSearchParams(window.location.search).get('ui'); } catch { /* no query */ }
  if (q === 'v3') {
    try { window.localStorage.setItem(KEY, 'v3'); } catch { /* not remembered */ }
    return true;
  }
  if (q === 'v2' || q === 'off') {
    try { window.localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
    return false;
  }
  try { return window.localStorage.getItem(KEY) === 'v3'; } catch { return false; }
}

/** Puts class "ui-v3" on <html> (for global tweaks such as the page background). Call once at startup. */
export function applyUiFlag(): boolean {
  const on = uiV3Enabled();
  try { document.documentElement.classList.toggle('ui-v3', on); } catch { /* no document */ }
  return on;
}
