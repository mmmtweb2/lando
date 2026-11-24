// Per-account cap on how many DIFFERENT businesses one account may pick in a day (QA 24.11, trust).
//
// Picking a search result shows that business's public Google data (score, rating, review count):
// the same data anyone sees on Google Maps, and nothing that needs the owner's Google sign-in. Still,
// an account that picks dozens of different businesses is browsing competitors, not connecting its
// own. Picking the same business again (re-checks, the setup's automatic first check, page reloads)
// never counts twice. In memory like middleware/rateLimit.ts: fine for one instance.

export const MAX_DISTINCT_PICKS_PER_DAY = 10;

export const SELECTION_LIMIT_MESSAGE =
  `בחרתם היום ${MAX_DISTINCT_PICKS_PER_DAY} עסקים שונים, וזה המקסימום ליום. כדי להגן על בעלי העסקים, אפשר לבחור עסקים נוספים מחר. אם זה העסק שלכם וצריך עזרה, כתבו לנו.`;

const picks = new Map<string, { day: string; places: Set<string> }>();

/** 'ok' → go ahead (and the place is remembered for today); 'limit' → too many different places today. */
export function takeSelection(email: string, placeId: string, now = new Date()): 'ok' | 'limit' {
  const day = now.toISOString().slice(0, 10);
  const key = email.trim().toLowerCase();
  let u = picks.get(key);
  if (!u || u.day !== day) {
    if (picks.size > 20_000) for (const [k, v] of picks) if (v.day !== day) picks.delete(k);
    u = { day, places: new Set() };
    picks.set(key, u);
  }
  if (u.places.has(placeId)) return 'ok';
  if (u.places.size >= MAX_DISTINCT_PICKS_PER_DAY) return 'limit';
  u.places.add(placeId);
  return 'ok';
}

/** Tests only. */
export function resetSelections(): void { picks.clear(); }
