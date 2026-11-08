// "אעשה אחר כך" in the setup: the same browser-kept list, under the same key, as GuidedSetup.tsx,
// so switching between v2 and v3 keeps the customer's place.
import { parseSkips, type GuidedId } from '../guided';

const SKIP_KEY = 'pagey_setup_skips:';

export function readSkips(email: string): GuidedId[] {
  try { return parseSkips(window.localStorage.getItem(SKIP_KEY + email)); } catch { return []; }
}
export function writeSkips(email: string, v: GuidedId[]) {
  try { window.localStorage.setItem(SKIP_KEY + email, JSON.stringify(v)); } catch { /* not remembered */ }
}
