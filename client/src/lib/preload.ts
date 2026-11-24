// Route chunks that are worth fetching BEFORE the visitor clicks (QA 24.11: /login stayed blank for
// seconds after a click on the homepage CTA). The same import() is used by React.lazy in App.tsx,
// so a preloaded chunk is simply already in the module cache when the route renders.

export const loadLogin = () => import('../pages/Login');

let loginStarted = false;
/** Fetches the login chunk once. A failed fetch is forgotten, so the click still retries it. */
export function preloadLogin(): void {
  if (loginStarted) return;
  loginStarted = true;
  loadLogin().catch(() => { loginStarted = false; });
}

/** True for a link to /login (with or without a query), the homepage CTAs and header links. */
export function isLoginLink(el: EventTarget | null): boolean {
  const a = (el as Element | null)?.closest?.('a[href]');
  const href = a?.getAttribute('href') ?? '';
  return /^\/login(?:[?#]|$)/.test(href);
}

/** Runs `cb` when the browser is idle (or after `fallbackMs` where requestIdleCallback is missing). */
export function whenIdle(cb: () => void, fallbackMs = 2500): () => void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(cb, { timeout: 4000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = setTimeout(cb, fallbackMs);
  return () => clearTimeout(t);
}
