import type { AreaId, PromoArea, PromoMode } from './areas';

/** The landing page that comes with the promotion subscription, as the pages list knows it. */
export interface IncludedPage {
  id: string;
  slug: string;
  status: 'draft' | 'published' | 'frozen' | (string & {});
  /** public address of the published page */
  url: string;
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
}
