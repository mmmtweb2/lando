// ─────────────────────────────────────────────────────────────────────────────
// Credit prices shown in the UI.
//
// MIRROR of src/config/credits.ts (the server is authoritative — it derives
// every charge itself and never trusts a cost sent by the client). This file
// exists so no Hebrew string ever hard-codes a price and quietly lies to the
// user after a repricing. If you change a number here, change it there too.
//
// The reasoning behind each price (real token / fal.ai cost per action) is
// documented in full in src/config/credits.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const CREDIT_COSTS = {
  /** Rewrite one text section. */
  TEXT_SECTION: 1,
  /** Rewrite the whole page's text. */
  TEXT_FULL_PAGE: 6,
  /** Regenerate one image. */
  IMAGE_SINGLE: 2,
  /** Regenerate the full image set (hero + up to 3 service images). */
  IMAGE_FULL_SET: 8,
  /** AI images generated while creating a new page. */
  CREATE_IMAGE_SET: 4,
} as const;
