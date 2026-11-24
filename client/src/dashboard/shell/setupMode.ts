import type { PromoArea } from './areas';

// "מצב הגדרה" and "התפריט המלא" (README part 149). Pure: no React, no network.
//
// The URL (?area=) is the one source of truth for WHICH screen shows. While the setup is not finished,
// the account has two menus:
//   setup – the sidebar holds one entry, and the home IS the setup (one step at a time)
//   full  – every entry; the home is the regular home
// Every other area always shows its OWN screen, on a click, a direct link and a reload, with a small
// "השלימו קודם את ההגדרה" banner while the setup is open. Opening such an area is itself a move to the
// full menu (otherwise the sidebar would have no entry to light). The setup never replaces another screen.

export type Menu = 'setup' | 'full';
/** none = no setup is open; guided = the older five-step setup; short = the automatic product's short setup */
export type SetupKind = 'none' | 'guided' | 'short';
export type PromoScreen = 'guided-setup' | 'short-setup' | 'area';

export interface ScreenInput {
  area: PromoArea;
  setup: SetupKind;
  /** the menu the customer chose last (remembered per account in this browser) */
  menu: Menu;
  /**
   * the short setup's last screen ("from here we work"): the setup itself is done, so there is no banner and no
   * menu switch; the screen shows on the home until the customer presses "לבית"
   */
  finishing?: boolean;
}

export interface ScreenChoice {
  screen: PromoScreen;
  /** the menu in effect: an area other than the home always means the full menu */
  menu: Menu;
  /** the small "השלימו קודם את ההגדרה" banner above the area's own screen */
  banner: boolean;
}

/** The areas that are the setup's own place, and therefore never carry the banner. */
const SETUP_PLACES: readonly PromoArea[] = ['home', 'setup'];

export function promoScreen({ area, setup, menu, finishing = false }: ScreenInput): ScreenChoice {
  if (finishing) return { screen: area === 'home' ? 'short-setup' : 'area', menu: 'full', banner: false };
  if (setup === 'none') return { screen: 'area', menu: 'full', banner: false };
  const eff: Menu = area === 'home' && menu === 'setup' ? 'setup' : 'full';
  if (eff === 'setup') return { screen: setup === 'guided' ? 'guided-setup' : 'short-setup', menu: eff, banner: false };
  return { screen: 'area', menu: eff, banner: !SETUP_PLACES.includes(area) };
}

/** Whether the sidebar shows the switch between the two menus. */
export const showsMenuSwitch = (setup: SetupKind, finishing = false): boolean => setup !== 'none' && !finishing;

/** The words of the switch between the two menus (in the sidebar) and of the banner. Plain, plural, no jargon. */
export const MENU_COPY = {
  setup: { line: 'אתם במצב הגדרה: מוצג רק הצעד הבא.', action: 'לתפריט המלא' },
  full: { line: 'ההגדרה עוד לא הושלמה.', action: 'חזרה להגדרה' },
  banner: { title: 'השלימו קודם את ההגדרה', line: 'אפשר כבר להסתכל כאן. חלק מהנתונים יופיעו רק אחרי שתסיימו את צעדי ההקמה.', action: 'להמשך ההגדרה' },
} as const;

const KEY = (email: string) => `pagey_dash_menu:${email.toLowerCase()}`;

/** The remembered menu. Storage can throw (private windows, blocked site data): then the setup menu. */
export function readMenu(email: string): Menu {
  try { return window.localStorage.getItem(KEY(email)) === 'full' ? 'full' : 'setup'; } catch { return 'setup'; }
}
export function writeMenu(email: string, menu: Menu): void {
  try { window.localStorage.setItem(KEY(email), menu); } catch { /* not remembered; the URL still decides the screen */ }
}
