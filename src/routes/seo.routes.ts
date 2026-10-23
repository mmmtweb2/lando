import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rateLimit';
import { requireProduct } from '../middleware/product.middleware';
import {
  deleteBusiness, getBusinesses, placeAudit, placesAutocomplete, saveBusiness,
} from '../controllers/seo.controller';
import { createChildPage, getChildPages, linkPage, removeChildPage } from '../controllers/seoChild.controller';
import { trackExternalEvent, trackPreflight } from '../controllers/seoTrack.controller';
import { createKit, deleteKit, getPlan, savePlan, suggest } from '../controllers/seoContent.controller';

const router = Router();

// PUBLIC: called by the tracking snippet on a customer's own website. Always 204; see the controller.
const trackLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'יותר מדי בקשות.' });
router.options('/track/:businessId', trackPreflight);
router.post('/track/:businessId', trackLimiter, trackExternalEvent);

// Any signed-in account may run the Audit (it is the on-ramp to the product), so these
// routes are NOT gated by requireProduct. Cost control: per-IP burst limit here plus a
// per-account daily cap in the controller.
const placesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  message: 'יותר מדי בקשות. נסו שוב בעוד דקה.',
});

router.post('/places/autocomplete', placesLimiter, requireAuth, placesAutocomplete);
router.get('/places/:placeId/audit', placesLimiter, requireAuth, placeAudit);

// Saved businesses belong to the paid product, so these ARE gated by requireProduct.
router.get('/businesses', placesLimiter, requireAuth, requireProduct('seo_autopilot'), getBusinesses);
router.post('/businesses', placesLimiter, requireAuth, requireProduct('seo_autopilot'), saveBusiness);
router.delete('/businesses/:id', placesLimiter, requireAuth, requireProduct('seo_autopilot'), deleteBusiness);

// Content plan + copy-ready kits for external sites (Stage 8). Same gating as saved businesses.
const gated = [placesLimiter, requireAuth, requireProduct('seo_autopilot')];
router.post('/phrases/suggest', ...gated, suggest);
router.get('/businesses/:id/plan', ...gated, getPlan);
router.put('/businesses/:id/plan', ...gated, savePlan);
router.post('/businesses/:id/content-kits', ...gated, createKit);
router.delete('/businesses/:id/content-kits/:kitId', ...gated, deleteKit);

// SEO child pages for businesses linked to a Pagey page (Stage 8.2b).
router.put('/businesses/:id/landing-page', ...gated, linkPage);
router.get('/businesses/:id/child-pages', ...gated, getChildPages);
router.post('/businesses/:id/child-pages', ...gated, createChildPage);
router.delete('/businesses/:id/child-pages/:pageId', ...gated, removeChildPage);

export default router;
