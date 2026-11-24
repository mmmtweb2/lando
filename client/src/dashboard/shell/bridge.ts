import type { AreaId, PromoArea, PromoMode } from './areas';
import type { Menu } from './setupMode';

/** The landing page that comes with the promotion subscription, as the pages list knows it. */
export interface IncludedPage {
  id: string;
  slug: string;
  status: 'draft' | 'published' | 'frozen' | (string & {});
  /** public address of the published page */
  url: string;
}

/** One of the account's own landing pages (root pages only), for the lists inside the promotion screens. */
export interface PageSummary {
  id: string;
  slug: string;
  name: string;
  status: IncludedPage['status'];
  /** public address (the page's own subdomain when it has one) */
  url: string;
  createdAt: string | null;
}

/** The switch between "מצב הגדרה" and "התפריט המלא", shown in the sidebar while a setup is open. */
export interface MenuSwitch {
  menu: Menu;
  onSwitch: () => void;
}

/** What the dashboard frame and the promotion screens tell each other. */
export interface PromoBridge {
  /** the promotion screen the sidebar chose */
  area: PromoArea;
  go: (area: AreaId) => void;
  /** the screens report what they look like in this account, so the sidebar lists the right entries */
  onMode: (mode: PromoMode) => void;
  page: IncludedPage | null;
  /** promotion only: show the quiet "רוצים דפי נחיתה נוספים?" link */
  morePagesLink: boolean;
  /** every page of the account, newest first (empty while loading or when the list failed) */
  pages?: PageSummary[];
  /** the sidebar shows the menu switch only while a setup is open (null = no switch) */
  onMenu?: (s: MenuSwitch | null) => void;
}
