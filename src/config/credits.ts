// ─────────────────────────────────────────────────────────────────────────────
// Credit pricing — the single source of truth for what every AI action costs.
//
// WHY THESE NUMBERS (repricing 2026-09-01, Moshe's call: "price credits by the
// token/AI cost they actually consume"). The old table was flat and unrelated
// to real spend: one image = 1, a whole image set = 4, one text section = 1, a
// whole page rewrite = 3, and images generated at page CREATION = 1 for the
// exact same batch that cost 4 to regenerate an hour later.
//
// Measured cost drivers, from the code that actually spends the money:
//
//  • Text — src/services/ai.service.ts.
//    A SINGLE-SECTION rewrite (`regenerateSectionText`) is ONE claude-sonnet-4-6
//    call: a short system prompt (section schema + the shared rules) and
//    max_tokens 512.
//    A FULL-PAGE rewrite runs the whole `generateAiContent` pipeline: TWO
//    sonnet calls (core, max_tokens 2048 + trust//detail, max_tokens 1536) on
//    top of the large `buildCoreSystem`/`buildTrustSystem` prompts (~19k chars
//    of prompt text combined vs. ~1.5k for a section). That is roughly 7-8x the
//    billed tokens of a single section, in and out.
//    → section = 1, full page = 6. Priced just under the raw 7-8x ratio: a
//      deliberate volume discount, and 6 keeps the table to round, easily
//      reasoned-about tiers while still being clearly "much more than double".
//
//  • Images — src/services/image.service.ts, fal.ai `flux/schnell`, one image
//    per `generateFalImage` call. A "full set" is NOT a flat unit of work: it
//    is hero + up to 3 service images = 4 fal calls (see `regenerateImageAi`,
//    `isFullSet` branch), i.e. exactly 4x a single regeneration.
//    → single image = 2, full set = 4 x 2 = 8. Per-image raw fal spend is
//      genuinely small, but an image is a discrete delivered asset (generation +
//      storage + serving) and Moshe's explicit pricing rule is that editing one
//      text section must cost less than regenerating an image — hence 2, not 1.
//      The full set scales with the real image count instead of being flat.
//
//  • Images at page CREATION (`CREATE_IMAGE_SET`) do the SAME work as a full-set
//    regeneration — hero + up to 3 service images through the same fal path —
//    so under a cost-based table they would be 8. They are deliberately priced
//    at 4 (50% off) as a one-time ACQUISITION DISCOUNT: it is the user's first
//    ever page and the moment they decide whether the product is worth paying
//    for. This is the one intentional deviation from cost-parity in the table,
//    and it replaces the old, unintentional 1-vs-4 inconsistency (which was a
//    ~87% discount nobody had chosen).
//
// STARTING_CREDITS is derived from the table, not picked: Moshe's requirement is
// that a new account can regenerate its images once and rewrite all of its text
// twice, plus a small bonus.
//   1 x full image-set regen (8) + 2 x full-page text rewrite (2 x 6 = 12) = 20
//   + 4 bonus  →  24.
// The 4-credit bonus is exactly one CREATE_IMAGE_SET, so a new user's very first
// page can be generated with AI images and still have the full 20 credits of
// editing budget Moshe asked for.
//
// Whole numbers only — no fractional credits are ever charged or displayed.
// The client mirrors this table in client/src/config/credits.ts; keep both in
// sync (the server is authoritative — it derives every charge itself and never
// trusts a client-supplied cost).
// ─────────────────────────────────────────────────────────────────────────────

export const CREDIT_COSTS = {
  /** Rewrite ONE text section (1 sonnet call, max_tokens 512). Cheapest action. */
  TEXT_SECTION: 1,
  /** Rewrite the WHOLE page's text (2 sonnet calls, ~7-8x a section's tokens). */
  TEXT_FULL_PAGE: 6,
  /** Regenerate ONE image (1 fal.ai flux/schnell call). */
  IMAGE_SINGLE: 2,
  /** Regenerate the FULL set: hero + up to 3 service images = 4 fal calls. */
  IMAGE_FULL_SET: 8,
  /** AI image set generated during page CREATION — same work as IMAGE_FULL_SET,
   *  half price as a deliberate one-time acquisition discount (see header). */
  CREATE_IMAGE_SET: 4,
} as const;

/**
 * Credits a brand-new account starts with. Must stay equal to the derivation
 * below (and to the DB default in migrations/011_credit_repricing.sql):
 *   1 full image-set regen + 2 full-page text rewrites + a 4-credit bonus.
 */
export const STARTING_CREDITS =
  CREDIT_COSTS.IMAGE_FULL_SET + 2 * CREDIT_COSTS.TEXT_FULL_PAGE + 4; // = 24
