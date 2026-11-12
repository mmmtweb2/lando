import { useCallback, useEffect, useState } from 'react';
import { areaFromQuery, queryWithArea, type AreaId } from './areas';

// The selected area lives in the URL (?area=reviews), so refresh and the browser's back button
// work. The rest of the query (?dash=, ?preview=, ?sample=, ?seo_subscription=, ...) is kept as it is.

function read(): AreaId | null {
  try { return areaFromQuery(window.location.search); } catch { return null; }
}

/** Remove query params without touching the others (the dashboard's one-shot deep links). */
export function dropQuery(...keys: string[]): void {
  try {
    const u = new URL(window.location.href);
    for (const k of keys) u.searchParams.delete(k);
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
  } catch { /* the address bar keeps the param; nothing breaks */ }
}

export interface AreaState {
  /** what the URL asks for; null = the account's default area */
  requested: AreaId | null;
  go: (area: AreaId) => void;
}

export function useArea(): AreaState {
  const [requested, setRequested] = useState<AreaId | null>(read);

  useEffect(() => {
    const onPop = () => setRequested(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // An old deep link (?leads=1, ?screen=card) is rewritten once to the canonical ?area= form.
  useEffect(() => {
    const first = read();
    if (!first) return;
    try {
      const next = window.location.pathname + queryWithArea(window.location.search, first, false) + window.location.hash;
      window.history.replaceState(window.history.state, '', next);
    } catch { /* keep the URL as it came */ }
  }, []);

  const go = useCallback((area: AreaId) => {
    setRequested(area);
    try {
      const next = window.location.pathname + queryWithArea(window.location.search, area, false) + window.location.hash;
      if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.pushState({}, '', next);
    } catch { /* state still changes; only the URL stays behind */ }
    try { window.scrollTo({ top: 0 }); } catch { /* old browsers */ }
  }, []);

  return { requested, go };
}
