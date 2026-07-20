import { Router } from 'express';
import { createLandingPage, getLandingPage, deleteLandingPage, getMyPages, getMyLeads, updateLandingPage, publishLandingPage, useAiEdit, updateImageUpload, regenerateImageAi, regenerateText } from '../controllers/landing.controller';
import { submitLead } from '../controllers/lead.controller';
import { handleUpload, handleSingleImageUpload } from '../middleware/upload.middleware';
import { rateLimit } from '../middleware/rateLimit';
import { requireAuth, requireOwnPage } from '../middleware/auth.middleware';

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

router.post('/', requireAuth, aiLimiter, handleUpload, createLandingPage);
router.get('/my-pages', requireAuth, getMyPages);   // must be before /:slug
router.get('/my-leads', requireAuth, getMyLeads);   // must be before /:slug
router.get('/:slug', getLandingPage);  // public read

// ── Destructive / owner-only actions ──────────────────────────────────────────
// requireAuth verifies the caller's identity from a real Supabase token;
// requireOwnPage confirms they own the page (or are an admin). This closes the
// hole where anyone with a page ID could edit/publish/delete/deface it.
router.post('/:id/publish', requireAuth, requireOwnPage, publishLandingPage);
router.post('/:id/regenerate-text', requireAuth, requireOwnPage, aiLimiter, regenerateText);
router.post('/:id/use-ai-edit', requireAuth, requireOwnPage, aiLimiter, useAiEdit);
router.post('/:id/update-image-upload', requireAuth, requireOwnPage, handleSingleImageUpload, updateImageUpload);
router.post('/:id/regenerate-image-ai', requireAuth, requireOwnPage, aiLimiter, regenerateImageAi);
router.patch('/:id', requireAuth, requireOwnPage, updateLandingPage);
router.delete('/:id', requireAuth, requireOwnPage, deleteLandingPage);

// Public, unauthenticated (visitor submitting the contact form) — rate-limited.
router.post('/:id/lead', leadLimiter, submitLead);

export default router;
