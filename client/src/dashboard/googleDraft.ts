// Pure rules for the "create a draft page from your Google card" line on the dashboard home.
import type { OverviewInput } from './journey';

/** Where the wizard lives (built in the pages area, not here). */
export function googleDraftPath(businessId: string): string {
  return `/create?from=google&business=${encodeURIComponent(businessId)}`;
}

/**
 * Same condition as the card in "My pages": a connected business with a Google card and no landing
 * page linked yet. Unknown link state (`landingLinked` absent) hides the line, so it never offers a
 * second page by mistake.
 */
export function showGoogleDraft(input: OverviewInput): boolean {
  return !!input.businessId && !!input.placeId && input.landingLinked === false;
}
