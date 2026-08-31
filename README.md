# Pagey — Engineering README

Pagey (formerly "Lando" / "Tirnoer Digital") is a live, production, Hebrew-first (RTL) SaaS at **pagey.co.il** that auto-generates AI landing pages for Israeli small businesses. This file is the single entry point for any agent joining work on this repo — read this before exploring the codebase; it should save you from re-deriving what's already known.

**Read this file first. Update it before you finish your task**, in the relevant section below. Keep entries short — this file is meant to be read whole, cheaply, not skimmed for the one paragraph that matters.

## Stack

- **Backend**: `src/` — Express + TypeScript (`npm run dev` / `build` / `start`), Postgres via Supabase, `pg` for raw queries.
- **Frontend**: `client/` — React 19 + TypeScript + Vite + Tailwind v4, react-router-dom v7, framer-motion, react-helmet-async. Separate `client/package.json` — build with `cd client && npm run build`.
- **Auth/DB**: Supabase (Postgres + Auth). RLS is enforced on `user_profiles`, `landing_pages`, `leads`, `payments` (see `migrations/007_security_rls_lockdown.sql`, `008_payments_table.sql`).
- **AI text**: Anthropic API (`src/services/ai.service.ts`) — falls back to mock content if `ANTHROPIC_API_KEY` is unset. Prompts include an explicit, itemized anti-fabrication rule (`NO_FABRICATION_RULE`, added 2026-08-31) forbidding invented stats/clients/awards/testimonials — applies to page generation AND the "regenerate this section" AI-edit flow.
- **AI images**: fal.ai (`FAL_KEY`). Stock fallback: Unsplash.
- **Email**: Resend (`src/services/*`, `RESEND_API_KEY`). Lead-notification HTML escapes all visitor-submitted fields (fixed 2026-08-31 — was an HTML-injection vector).
- **Payments**: SUMIT (Israeli provider) — the **real, verified** checkout path is `src/controllers/payment.controller.ts` + `src/services/summit.service.ts` (server-side webhook verification, idempotent), covering both one-off credit packs and the `freelancer`/`agency` yearly plans (`src/config/plans.ts`). There is a separate **mock** checkout (`purchaseCredits` in `user.controller.ts`) used for local/dev testing only — hard-disabled when `NODE_ENV=production` and requires real auth (fixed 2026-08-31).
- **Plans**: `free` / `freelancer` / `agency` (`src/config/plans.ts`). `agency` includes `whiteLabel: true` — this is now actually delivered on the public page (badge + title suffix hidden, fixed 2026-08-31; previously sold but never implemented).
- **Migrations**: plain numbered SQL files in `migrations/`, run manually/via deploy — no migration framework. Read the filenames in order; several are clearly bug-driven patches (e.g. `007_security_rls_lockdown.sql`), which is useful signal for what's broken before.
- **Deploy**: Docker (`Dockerfile`), Node 22 (needed for native WebSocket / Supabase realtime — see `git log` for the docker fix commits).
- **Post-deploy smoke test**: `smoke-test.mjs` at repo root (`node smoke-test.mjs [baseUrl]`). Checks: old-brand-string leaks ("Tirnoer"/"Tirnoer Digital"), dead `localhost` links, empty `<title>`, `robots.txt`/`sitemap.xml` correctness, homepage meta description + `og:title`/`og:image`, malformed `wa.me/` WhatsApp numbers, missing `<img alt>`. **Before reporting a bug in any of these categories, read this file — it may already be guarded.**
- **Known environment quirk**: `cd client && npm run build` currently fails inside the sandboxed dev VM used for this work (`rolldown`/vite native binding missing for `linux-arm64-gnu` — an artifact of `node_modules` being installed for a different architecture than that VM). `npx tsc -b --noEmit` is the reliable correctness check in that environment and was kept clean throughout. Verify a real build in your normal local/CI/Docker environment before deploying — not yet confirmed there.

## Working conventions (read before touching code)

1. **This is a live production app with real users and real money (SUMIT).** Treat every change as a deploy candidate, not a sandbox experiment. No destructive commands, no direct edits to `main`.
2. **Branch per workstream**, name `fix/<slug>` or `feat/<slug>`. Commit locally; **do not push** without explicit sign-off from Moshe (product owner) — payments/auth/security changes especially. Work as of 2026-08-31 lives on branch `dev` (not yet merged to `main`/pushed).
3. **Auth pattern**: never trust `req.body.email` (or any client-supplied identifier) for identity — use `req.authEmail`, set by `requireAuth` (`src/middleware/auth.middleware.ts`) after verifying the Supabase bearer token. `requireOwnPage` additionally checks page ownership or admin. `optionalAuth` (added 2026-08-31) is for public routes that want to *optionally* know the caller's identity (e.g. to compute an `isOwner` flag) without requiring login. Follow this pattern for any new route — this bit the codebase twice (the credits-purchase exploit, and a second unauthenticated-profile-disclosure bug on `POST /api/users/auth`, both fixed 2026-08-31).
4. **Error responses**: return `{ error: message }` (or `{ error, details }`), never `error.stack` or a raw DB error message, to API clients — even on public/unauthenticated routes (`submitLead` was leaking raw Postgres errors until 2026-08-31).
5. **Public endpoints and PII**: don't `select('*')`-and-spread a DB row into a public JSON response without checking every column — `landing_pages.owner_email` was being leaked this way to any visitor on `GET /api/landing/:slug` until 2026-08-31 (now stripped; ownership is exposed as a server-computed `isOwner` boolean instead).
6. **User-submitted content going into HTML** (emails, any future SSR) must be escaped — the lead-notification email was interpolating visitor-submitted fields unescaped until 2026-08-31.
7. **RLS**: any new table needs an explicit RLS policy — check `migrations/007_security_rls_lockdown.sql` for the pattern used on existing tables.
8. **Client-side caches must be re-validated against the current auth identity, not just checked for existence.** `UserContext`'s localStorage-cached profile was reused across different logged-in accounts on a shared browser until 2026-08-31 (`App.tsx`'s `SyncAuth` now compares the cached profile's email to the current Supabase session's email before trusting it).
9. **Before you build a feature**, grep for it — this codebase has had rebrands and leftover legacy code. Don't assume a file that looks relevant is live/current; check what's actually routed/imported. (`ClientPortal.tsx`/`/portal` was exactly this — deleted 2026-08-31, see Fixed.)
10. **Language**: user-facing strings are Hebrew, RTL (`dir="rtl"`). Match this in new UI/error messages.
11. **Content generation and fabrication risk**: the product's core value is AI-written page copy for real businesses. Never let a prompt change relax the no-fabrication guarantee (see `NO_FABRICATION_RULE` in `ai.service.ts`) — no invented stats, client names, dates, awards, or testimonials, ever, even to make copy sound "richer."
12. **Token/cost discipline**: don't re-read the whole repo — this README + targeted `grep`/`Read` of the specific files you're touching is enough for almost every task. Use the Backlog below as ground truth for known issues instead of re-auditing from scratch. For genuinely parallel work by multiple agents, use `git worktree` off `dev` (see e.g. commit history around 2026-08-31) rather than multiple agents editing the same working copy concurrently — symlink `node_modules` (root + `client/`) and `.env` into each worktree rather than reinstalling.

## Backlog

Legend: 🔴 critical · 🟠 high · 🟡 medium · ⚪ missing feature (not a bug)

### Fixed (2026-08-31)
- 🔴 Free-credit exploit (`POST /api/users/credits/purchase`, no auth, trusted client email) — now requires `requireAuth`, uses `req.authEmail`, mock-payment path 403s in production.
- 🔴 Unauthenticated profile disclosure (`POST /api/users/auth`, no auth at all, returned any user's `affiliate_code`/`credits`/`earned_coupons`/referral info given just their email) — now requires `requireAuth`, identity comes only from the verified session.
- 🟠 Stack traces leaked to API clients on `createLandingPage` 500s.
- 🟠 Raw DB error text leaked to anonymous callers on lead-submission failure.
- 🟠 HTML-injection via unescaped visitor-submitted fields in lead-notification emails.
- 🟠 `owner_email` PII leaked to every visitor via the public `GET /api/landing/:slug` — replaced with a server-computed `isOwner` boolean (new `optionalAuth` middleware).
- 🟠 Shared-browser identity confusion: cached `UserContext` profile (localStorage) was reused across different logged-in Supabase accounts without re-validation.
- 🟠 `/portal` legacy route deleted (`ClientPortal.tsx` removed) — unreachable from any nav, ran its own broken pre-Supabase auth/logout logic. Product decision by Moshe.
- 🟠 Custom image upload in the edit modal always 401'd (plain `fetch` instead of `authFetch`) — now fixed.
- 🟠 Agency plan's white-label perk was sold (purchase flow worked end-to-end) but never delivered — "נוצר באמצעות Pagey" badge and `| Pagey` title suffix are now actually hidden for white-label owners.
- 🟡 Primary CTA button/FAB could point at a dead `wa.me`/`tel:` link when the chosen contact method's field was empty — now falls back across whatever contact info the business actually provided.
- Dashboard sidebar nav ("הדפǙם שלי"/"לידים"/"הגדרות") is now wired to the app's real tab-switching state (was fully decorative). Added a "הגדרות" (Settings) section consolidating plan/credits/billing UI — serves as the "dedicated billing settings page" ask, as a dashboard section rather than a new route.
- Added a full forgot/reset-password flow (`ResetPassword.tsx`, Supabase `resetPasswordForEmail`/`updateUser`). **Needs Moshe to check the Supabase dashboard**: Auth → URL Configuration must allowlist `https://pagey.co.il/reset-password` (+ local dev origin), and the "Reset Password" email template is worth a look.
- AI generation prompts: extracted and strengthened the anti-fabrication rule (now itemized, forceful, applied to page-generation AND the "regenerate this section" AI-edit path, which previously had no such guardrail at all). Added a consistent typographic "kicker" label above section headings across design-style variants (small visual polish pass).

### Open — backend
- 🟡 Race condition on monthly page-creation cap (`src/services/plan.service.ts:116-131`, `consumeMonthlyCreate`) — reads-then-writes without an atomic guard, unlike `credits.service.ts`'s `checkAndDeductCredits` (`.gte()`). Low impact (off-by-one), same bug class already fixed elsewhere.
- 🟡 `leadLimiter` (public lead-submission rate limit) is per-IP only, not per-page — a determined multi-IP flood against one specific business's page isn't scoped out. Low severity, basic anti-spam is still in place.
- 🟡 Lead form's phone field has no format validation server- or client-side beyond `required` — garbage input silently creates unreachable leads.
- ⚪ `og.controller.ts`: `seo_description`/`hero.subtitle` OG-description fallbacks aren't length-capped the way `about.content`'s is — an unusually long AI description could produce an oversized `og:description`. Minor SEO nit.

### Open — frontend
- 🟠 **No mobile navigation on the dashboard at all** (not just "unwired") — the sidebar is `hidden lg:flex` with zero mobile equivalent (no hamburger/drawer); a mobile user can currently reach only logout. Now more visible/worth prioritizing since the sidebar itself got real content (Settings section) behind it. Needs a real (if modest) implementation, not a one-line fix — flagged for the next pass rather than done ad hoc.
- 🟡 No catch-all `*` route in `client/src/App.tsx` — unmatched URLs render a blank page instead of a proper 404.
- 🟡 Several silent `.catch(() => setX([]))` patterns and one unused-error catch in `AdminDashboard.tsx:166` hide real failures from users/devs.
- 🟡 Failed data fetches on the dashboard (`fetchData()`, `/api/user/plan`) fail silently to empty/absent states indistinguishable from "new account, nothing here yet" — no visible error or retry.
- 🟡 Low-contrast secondary text (`text-slate-400` on light backgrounds, ~2.8:1) used for real body/pricing copy, not just captions, on the marketing homepage (`MarketingLanding.tsx`) — under WCAG AA's 4.5:1.
- 🟡 ESLint (pre-existing, not newly introduced): `Dashboard.tsx` and `LandingViewer.tsx` set state synchronously inside a couple of `useEffect`s (`react-hooks/set-state-in-effect` — a performance/correctness smell, not a live bug). The `LandingViewer.tsx` "unused `prompt` assignment" flagged in an earlier pass turned out to be a harmless redundant initializer (`let prompt = '';` always overwritten by both branches below it), not incomplete logic — confirmed, not a bug.
- 🟡 FAQ accordion buttons on the marketing homepage lack `aria-expanded`/`aria-controls`.
- ⚪ Marketing homepage's "Examples" showcase section is wired up but currently ships empty (`SHOWCASE = []`, `MarketingLanding.tsx`) — the homepage has zero social-proof examples live. Needs real published-page slugs added, or the section removed.

### Missing basic features (⚪ product scope)
- No duplicate/clone-a-landing-page action.
- No analytics/page-views dashboard (only lead capture exists).

## Agent log

Append one entry per work session — what you touched, what you decided, what's still open. Keep it to a few lines.

- **2026-08-31, CEO orchestration session, part 1**: ran parallel backend+frontend audit (2 agents), fixed the free-credit exploit + stack-trace leak, wrote this README.
- **2026-08-31, part 2**: on Moshe's go-ahead, ran 4 parallel feature agents in isolated `git worktree`s off a new `dev` branch (sidebar/settings, agency white-label delivery, password reset, AI content+visual polish) plus 3 parallel read-only UI/UX+security audits (marketing page, dashboard, public product page). Merged all 4 feature branches into `dev` cleanly (no conflicts), then fixed the additional concrete bugs the final audit round surfaced directly on `dev` (profile-disclosure hole, shared-browser identity confusion, lead-email HTML injection, owner-email PII leak, dead CTA links) and deleted the legacy `/portal` route per Moshe's decision. `tsc` clean on both backend and client throughout. Worktrees cleaned up after merge. Still open: `dev` not merged to `main`/not pushed (awaiting Moshe), mobile dashboard nav, and the remaining 🟡/⚪ items above.
