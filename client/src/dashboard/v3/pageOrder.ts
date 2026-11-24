import type { PageSummary } from '../shell/bridge';

// The order of the account's pages in the promotion screens (README part 149). Pure, for the tests.

/** The business's own page first, then newest first. */
export function orderPages(pages: readonly PageSummary[], ownPageId: string | null): PageSummary[] {
  const byDate = [...pages].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const own = byDate.find((p) => p.id === ownPageId);
  return own ? [own, ...byDate.filter((p) => p !== own)] : byDate;
}

/**
 * The page the "connect a page" selector starts on: the business's own page (the one the subscription names,
 * README part 143), else the page that has the business card behind it, else the newest page.
 */
export function defaultPageId(pages: readonly { id: string; created_at?: string | null; card_refresh?: boolean }[], ownPageId: string | null): string {
  if (ownPageId && pages.some((p) => p.id === ownPageId)) return ownPageId;
  const card = pages.find((p) => p.card_refresh === true);
  if (card) return card.id;
  const newest = [...pages].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
  return newest?.id ?? '';
}
