import { Router } from 'express';
import { createLandingPage, getLandingPage, deleteLandingPage, getMyPages, getMyLeads, updateLandingPage, publishLandingPage, getIncludedPublish, useAiEdit, updateImageUpload, regenerateImageAi, regenerateText, suggestQuestions, trackView, trackCtaClick, trackLeadEvent, updateLogo, removeLogo, removeImage } from '../controllers/landing.controller';
import { submitLead } from '../controllers/lead.controller';
import { handleUpload, handleSingleImageUpload } from '../middleware/upload.middleware';
import { rateLimit } from '../middleware/rateLimit';
import { rejectOversizeBody } from '../middleware/bodyLimit';
import { LEAD_MAX_BODY_BYTES } from '../utils/leadInput';
import { requireAuth, requireOwnPage, optionalAuth } from '../middleware/auth.middleware';
import { prefillFromGoogle } from '../controllers/landingPrefill.controller';

const router = Router();

// Creating/regenerating a page calls the AI (real $ per request) → keep it tight.
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  message: 'ביצעתם הרבה פעולות AI בזמן קצר. נסו שוב בעוד שעה.',
});
// Lead submission is public and unauthenticated → protect against spam floods.
const leadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15,
  message: 'יותר מדי שליחות בזמן קצר. נסו שוב מאוחר יותר.',
});

// Second, tighter per-IP bucket keyed by IP + PAGE: one visitor/bot cannot mail-bomb a single
// business's inbox even while staying under the per-IP bucket above.
const leadPageLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  key: (req) => `${req.ip || req.socket.remoteAddress || 'unknown'}|${req.params.id}`,
  message: 'שלחתם כבר כמה פניות לדף הזה. נסו שוב מאוחר יותר.',
});

// Optional wizard intake step — one cheap Haiku call, its own (looser) budget so
// it can never eat into the page-generation allowance above.
const suggestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 60,
  message: 'יותר מדי בקשות בזמן קצר. נסו שוב מאוחר יותר.',
});

// Public page-view read (GET /:slug) — legitimate traffic can be bursty (a
// shared link, a business's own refreshing dashboard tab), so this is
// deliberately generous compared to the write-side limiters above; it exists
// only to stop a scripted flood from hammering the DB on every hit.
const pageViewLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: 'יותר מדי בקשות בזמן קצר. נסו שוב בעוד רגע.',
});


// Public analytics counters (view/CTA-click) — real, unauthenticated visitor
// traffic, so no requireAuth, but these are WRITES (unlike the page-read GET
// above), and a write endpoint is a much cheaper target for someone trying to
// inflate a page's numbers than a read is. Tighter than pageViewLimiter's
// 120/min for that reason, but still generous enough that a real page with a
// legitimate traffic spike (a WhatsApp broadcast, a Facebook ad) never gets
// throttled — a genuine visitor only ever fires one view + at most a handful
// of CTA clicks per session.
const trackLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 40,
  message: 'יותר מדי בקשות בזמן קצר. נסו שוב בעוד רגע.',
});

router.post('/', requireAuth, aiLimiter, handleUpload, createLandingPage);
router.post('/suggest-questions', requireAuth, suggestLimiter, suggestQuestions); // must be before /:slug-style params
router.get('/my-pages', requireAuth, getMyPages);   // must be before /:slug
router.get('/my-leads', requireAuth, getMyLeads);   // must be before /:slug
// Wizard prefill from a connected Google business (task #16). Burst limit here, per-account daily cap in the service.
const prefillLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' });
router.get('/prefill-from-google/:businessId', prefillLimiter, requireAuth, prefillFromGoogle); // before /:slug
router.get('/:slug', pageViewLimiter, optionalAuth, getLandingPage);  // public read; optionalAuth lets it compute isOwner

// Public, unauthenticated, fire-and-forget analytics (v1 — see
// migrations/019_page_analytics.sql). Must come before /:id-style routes
// below only matters for path-shape collisions, which these don't have
// (POST /:slug/track-view vs POST /:id/publish etc. — different literal
// suffixes so ordering here is not load-bearing, but kept next to the other
// public :slug route for readability).
router.post('/:slug/track-view', trackLimiter, trackView);
router.post('/:slug/track-cta-click', trackLimiter, trackCtaClick);
router.post('/:slug/event', trackLimiter, trackLeadEvent); // WhatsApp / call click → lead_events (migration 026)

// ── Destructive / owner-only actions ──────────────────────────────────────────
// requireAuth verifies the caller's identity from a real Supabase token;
// requireOwnPage confirms they own the page (or are an admin). This closes the
// hole where anyone with a page ID could edit/publish/delete/deface it.
router.get('/:id/included', requireAuth, requireOwnPage, getIncludedPublish);
router.post('/:id/publish', requireAuth, requireOwnPage, publishLandingPage);
router.post('/:id/regenerate-text', requireAuth, requireOwnPage, aiLimiter, regenerateText);
router.post('/:id/use-ai-edit', requireAuth, requireOwnPage, aiLimiter, useAiEdit);
router.post('/:id/update-image-upload', requireAuth, requireOwnPage, handleSingleImageUpload, updateImageUpload);
router.post('/:id/update-logo', requireAuth, requireOwnPage, handleSingleImageUpload, updateLogo);
router.delete('/:id/logo', requireAuth, requireOwnPage, removeLogo);
router.delete('/:id/image/:slot', requireAuth, requireOwnPage, removeImage);
router.post('/:id/regenerate-image-ai', requireAuth, requireOwnPage, aiLimiter, regenerateImageAi);
router.patch('/:id', requireAuth, requireOwnPage, updateLandingPage);
router.delete('/:id', requireAuth, requireOwnPage, deleteLandingPage);

// Public, unauthenticated (visitor submitting the contact form) — rate-limited.
router.post('/:id/lead', leadLimiter, rejectOversizeBody(LEAD_MAX_BODY_BYTES), leadPageLimiter, submitLead);

export default router;
