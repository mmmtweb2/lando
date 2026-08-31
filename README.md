# Pagey — Engineering README

Pagey (formerly "Lando" / "Tirnoer Digital") is a live, production, Hebrew-first (RTL) SaaS at **pagey.co.il** that auto-generates AI landing pages for Israeli small businesses. This file is the single entry point for any agent joining work on this repo — read this before exploring the codebase; it should save you from re-deriving what's already known.

**Read this file first. Update it before you finish your task**, in the relevant section below. Keep entries short — this file is meant to be read whole, cheaply, not skimmed for the one paragraph that matters.

## Stack

- **Backend**: `src/` — Express + TypeScript (`npm run dev` / `build` / `start`), Postgres via Supabase, `pg` for raw queries.
- **Frontend**: `client/` — React 19 + TypeScript + Vite + Tailwind v4, react-router-dom v7, framer-motion, react-helmet-async. Separate `client/package.json` — build with `cd client && npm run build`.
- **Auth/DB**: Supabase (Postgres + Auth). RLS is enforced on `user_profiles`, `landing_pages`, `leads`, `payments` (see `migrations/007_security_rls_lockdown.sql`, `008_payments_table.sql`).
- **AI text**: Anthropic API (`src/services/ai.service.ts`) — falls back to mock content if `ANTHROPIC_API_KEY` is unset.
- **AI images**: fal.ai (`FAL_KEY`). Stock fallback: Unsplash.
- **Email**: Resend (`src/services/*`, `RESEND_API_KEY`).
- **Payments**: SUMIT (Israeli provider) — the **real, verified** checkout path is `src/controllers/payment.controller.ts` + `src/services/summit.service.ts` (server-side webhook verification, idempotent). There is a separate **mock** checkout (`purchaseCredits` in `user.controller.ts`) used for local/dev testing only — it is hard-disabled when `NODE_ENV=production` (fixed 2026-08-31, see Fixed section).
- **Migrations**: plain numbered SQL files in `migrations/`, run manually/via deploy — no migration framework. Read the filenames in order; several are clearly bug-driven patches (e.g. `007_security_rls_lockdown.sql`), which is useful signal for what's broken before.
- **Deploy**: Docker (`Dockerfile`), Node 22 (needed for native WebSocket / Supabase realtime — see `git log` for the docker fix commits).
- **Post-deploy smoke test**: `smoke-test.mjs` at repo root (`node smoke-test.mjs [baseUrl]`). Checks: old-brand-string leaks ("Tirnoer"/"Tirnoer Digital"), dead `localhost` links, empty `<title>`, `robots.txt`/`sitemap.xml` correctness, homepage meta description + `og:title`/`og:image`, malformed `wa.me/` WhatsApp numbers, missing `<img alt>`. **Before reporting a bug in any of these categories, read this file — it may already be guarded.**

## Working conventions (read before touching code)

1. **This is a live production app with real users and real money (SUMIT).** Treat every change as a deploy candidate, not a sandbox experiment. No destructive commands, no direct edits to `main`.
2. **Branch per workstream**, name `fix/<slug>` or `feat/<slug>`. Commit locally; **do not push** without explicit sign-off from Moshe (product owner) — payments/auth/security changes especially.
3. **Auth pattern**: never trust `req.body.email` for identity — use `req.authEmail`, set by `requireAuth` (`src/middleware/auth.middleware.ts`) after verifying the Supabase bearer token. `requireOwnPage` additionally checks page ownership or admin. Follow this pattern for any new authenticated route.
4. **Error responses**: return `{ error: message }` (or `{ error, details }`), never `error.stack`, to API clients.
5. **RLS**: any new table needs an explicit RLS policy — check `migrations/007_security_rls_lockdown.sql` for the pattern used on existing tables.
6. **Before you build a feature**, grep for it — this codebase has had rebrands and leftover legacy code (e.g. `client/src/pages/ClientPortal.tsx` is a pre-Supabase-migration leftover, not linked from any nav — see Backlog). Don't assume a file that looks relevant is live/current; check what's actually routed/imported.
7. **Language**: user-facing strings are Hebrew, RTL (`dir="rtl"`). Match this in new UI/error messages.
8. **Token/cost discipline**: don't re-read the whole repo — this README + targeted `grep`/`Read` of the specific files you're touching is enough for almost every task. Use the Backlog below as ground truth for known issues instead of re-auditing from scratch.

## Backlog (from full backend+frontend audit, 2026-08-31)

Legend: 🔴 critical · 🟠 high · 🟡 medium · ⚪ missing feature (not a bug)

### Fixed
- 🔴 **Free-credit exploit** — `POST /api/users/credits/purchase` had no auth and trusted a client-supplied email; anyone could grant themselves/anyone unlimited free credits via the mock-payment path. **Fixed**: route now requires `requireAuth`, uses `req.authEmail` only, and the mock-payment branch 403s when `NODE_ENV=production`. Commit: `fix(security): close unauthenticated free-credit exploit; stop leaking stack traces`.
- 🟠 **Stack traces leaked to API clients** on `createLandingPage` 500s (`landing.controller.ts`) — was the one controller returning `error.stack`; now matches the rest (message only). Same commit as above.

### Open — backend
- 🟡 **Race condition on monthly page-creation cap** (`src/services/plan.service.ts:116-131`, `consumeMonthlyCreate`) — reads-then-writes without an atomic guard, unlike `credits.service.ts`'s `checkAndDeductCredits` which correctly uses `.gte()`. Concurrent requests near the cap can create one extra page beyond plan limit. Low impact, same bug class already fixed elsewhere — good small fix for whoever picks up backend work next.

### Open — frontend
- 🟠 **`/portal` "sign out" doesn't end the real session** (`client/src/pages/ClientPortal.tsx`) — only clears legacy `UserContext`/localStorage, never calls `supabase.auth.signOut()`. The Supabase JWT stays valid. **BUT**: this whole `/portal` route is unreachable from the UI (nothing links to it — `grep -rn "/portal" client/src` only finds the route declaration itself) and uses a different, pre-Supabase-migration auth system than the rest of the app (`Dashboard.tsx` etc. use `AuthContext`/`useAuth` correctly). **Product decision needed: delete this legacy route, or bring it in line with the real auth system?** → ask Moshe.
- 🟠 **Custom image upload always fails (401)** in the landing-page edit modal — `client/src/pages/LandingViewer.tsx` calls the upload endpoint with plain `fetch` instead of `authFetch`, so no `Authorization` header is sent, and the backend route requires it strictly (no cookie fallback). This is a real, live, broken feature — safe to fix directly (swap to `authFetch`), no product judgment needed.
- 🟡 No catch-all `*` route in `client/src/App.tsx` — unmatched URLs render a blank page instead of a proper 404.
- 🟡 Several silent `.catch(() => setX([]))` patterns and one unused-error catch in `AdminDashboard.tsx:166` hide real failures from users/devs — swap for at least a console.error + user-visible error state.
- 🟡 ESLint flags real (non-stylistic) issues: `Dashboard.tsx:338,432` and `LandingViewer.tsx:381,864` set state synchronously inside `useEffect` (react-hooks/set-state-in-effect); `LandingViewer.tsx:946` assigns to `prompt` and never uses it (likely incomplete logic — worth a look, not just a lint suppress).

### Missing basic features (⚪ product scope — priority TBD by Moshe)
- No duplicate/clone-a-landing-page action (backend has no endpoint, frontend has no button).
- No analytics/page-views dashboard (only lead capture exists).
- No password-reset flow (`Login.tsx` has sign-in/sign-up/magic-link only; no `resetPasswordForEmail`).
- No dedicated account/billing settings page (credits/plan purchase is inline in `Dashboard.tsx`).

## Agent log

Append one entry per work session — what you touched, what you decided, what's still open. Keep it to a few lines.

- **2026-08-31, CEO orchestration session**: ran parallel backend+frontend audit (2 agents), fixed the two unambiguous critical/high bugs (free-credit exploit, stack-trace leak) on branch `fix/critical-free-credits-exploit`, wrote this README, compiled backlog above. Did not push (awaiting Moshe's go-ahead + priority call on the open items and missing-features list).
