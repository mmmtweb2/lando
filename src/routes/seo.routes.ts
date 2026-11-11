import { getJourney, postAccountEvent, postActivate, postSetupComplete, putBusiness, putPendingProfile, startJourney } from '../controllers/journey.controller';
import { dismissDraft, listDrafts, publishDraft } from '../controllers/reviewDrafts.controller';
import { getBusinessServices, putBusinessServices } from '../controllers/businessServices.controller';
import express, { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rateLimit';
import { requireProduct } from '../middleware/product.middleware';
import {
  deleteBusiness, getBusinesses, placeAudit, placesAutocomplete, saveBusiness,
} from '../controllers/seo.controller';
import { createChildPage, getChildPages, linkPage, removeChildPage } from '../controllers/seoChild.controller';
import { getPremium } from '../controllers/premiumStatus.controller';
import { trackExternalEvent, trackPreflight } from '../controllers/seoTrack.controller';
import { cancel as cancelSub, getPlans as subPlans, getStatus as subStatus, start as startSub, subscriptionReturn, subscriptionWebhook } from '../controllers/seoSubscription.controller';
import { createKit, deleteKit, getPlan, savePlan, suggest } from '../controllers/seoContent.controller';
import { getSetup, putSetup } from '../controllers/seoSetup.controller';
import * as gbp from '../controllers/gbp.controller';
import * as auto from '../controllers/autopilot.controller';
import { sendFeedback } from '../controllers/feedback.controller';
import { unsubscribeApply, unsubscribePage } from '../controllers/digest.controller';
import { addRequest, deleteRequest, listRequests, reviewedRequest, sentRequest } from '../controllers/reviewRequests.controller';

const router = Router();

// PUBLIC: called by the tracking snippet on a customer's own website. Always 204; see the controller.
const trackLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'יותר מדי בקשות.' });
router.options('/track/:businessId', trackPreflight);
router.post('/track/:businessId', trackLimiter, trackExternalEvent);

// Monthly subscription (Stage 9.2). Off until SEO_SUBSCRIPTION_ENABLED=true. NOT gated by
// requireProduct: this is how an account GETS the product. The return and webhook endpoints are
// public by nature (SUMIT calls them) and trust nothing in the request: every payment is
// re-read from SUMIT server-to-server first, and a SUMIT payment id can be used once, ever.
const subLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' });
router.get('/plans', subLimiter, subPlans);
router.get('/subscription', subLimiter, requireAuth, subStatus);
router.post('/subscription/start', subLimiter, requireAuth, startSub);
router.post('/subscription/cancel', subLimiter, requireAuth, cancelSub);
// Same reasoning as payments /return (routes/payment.routes.ts): each hit can cost a SUMIT call.
const subReturnLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, message: 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.' });
router.get('/subscription/return', subLimiter, subReturnLimiter, subscriptionReturn);
router.post('/subscription/webhook', subLimiter, express.urlencoded({ extended: true, limit: '20kb' }), subscriptionWebhook);

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
// Tester/customer feedback (migration 034). Per-IP burst limit here, per-account daily cap in the service.
const feedbackLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' });
router.post('/feedback', feedbackLimiter, requireAuth, requireProduct('seo_autopilot'), sendFeedback);

// Monthly summary email: public, signed-token unsubscribe (GET only shows a button, POST applies).
const digestLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: 'יותר מדי בקשות.' });
router.get('/digest/unsubscribe', digestLimiter, unsubscribePage);
router.post('/digest/unsubscribe', digestLimiter, unsubscribeApply);

// Review requests (stage 7, migration 035): the owner's list of customers to ask for a review.
// The owner sends each message from their own WhatsApp; nothing here sends anything.
const rrLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' });
router.get('/review-requests', rrLimiter, requireAuth, requireProduct('seo_autopilot'), listRequests);
router.post('/review-requests', rrLimiter, requireAuth, requireProduct('seo_autopilot'), addRequest);
router.post('/review-requests/:id/sent', rrLimiter, requireAuth, requireProduct('seo_autopilot'), sentRequest);
router.post('/review-requests/:id/reviewed', rrLimiter, requireAuth, requireProduct('seo_autopilot'), reviewedRequest);
router.delete('/review-requests/:id', rrLimiter, requireAuth, requireProduct('seo_autopilot'), deleteRequest);

// Customer journey (task #9, migration 039). Any signed-in account may walk it: it is the on-ramp
// to the product, so these are NOT gated by requireProduct.
const journeyLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' });
router.get('/journey', journeyLimiter, requireAuth, getJourney);
router.post('/journey/start', journeyLimiter, requireAuth, startJourney);
router.put('/journey/business', journeyLimiter, requireAuth, putBusiness);
router.put('/journey/profile-pending', journeyLimiter, requireAuth, putPendingProfile);
router.post('/journey/setup-complete', journeyLimiter, requireAuth, postSetupComplete);
router.post('/journey/activate', journeyLimiter, requireAuth, postActivate);
router.post('/journey/event', journeyLimiter, requireAuth, postAccountEvent);

router.get('/review-drafts', rrLimiter, requireAuth, requireProduct('seo_autopilot'), listDrafts);
router.post('/review-drafts/:id/publish', rrLimiter, requireAuth, requireProduct('seo_autopilot'), publishDraft);
router.post('/review-drafts/:id/dismiss', rrLimiter, requireAuth, requireProduct('seo_autopilot'), dismissDraft);
router.get('/businesses/:id/services', rrLimiter, requireAuth, requireProduct('seo_autopilot'), getBusinessServices);
router.put('/businesses/:id/services', rrLimiter, requireAuth, requireProduct('seo_autopilot'), putBusinessServices);
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

// One-time setup checklist ticks (dashboard v2.1, migration 032).
router.get('/premium', ...gated, getPremium);
router.get('/setup', ...gated, getSetup);
router.put('/setup/:key', ...gated, putSetup);

// Google Business Profile connection (Stage 6.3, migration 033). Off unless GBP_CONNECT_ENABLED=true.
// The callback is public (Google redirects the browser to it) and trusts only the signed state.
const gbpLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' });
router.get('/gbp/status', gbpLimiter, requireAuth, requireProduct('seo_autopilot'), gbp.status);
router.get('/gbp/oauth/start', gbpLimiter, requireAuth, requireProduct('seo_autopilot'), gbp.start);
router.get('/gbp/oauth/callback', gbpLimiter, gbp.callback);
router.post('/gbp/disconnect', gbpLimiter, requireAuth, requireProduct('seo_autopilot'), gbp.disconnect);
router.get('/gbp/stats', gbpLimiter, requireAuth, requireProduct('seo_autopilot'), gbp.stats);
router.put('/gbp/location', gbpLimiter, requireAuth, requireProduct('seo_autopilot'), gbp.chooseLocation);

// The automatic product (docs/mvp-plan.md, part A; migration 048): the business card everything is
// written from, the customer's automation choices, the weekly posts and the activity log.
// Publishing itself is off unless AUTOPILOT_ENABLED=true; these routes work either way.
const autoLimiter = rateLimit({ windowMs: 60 * 1000, max: 40, message: 'יותר מדי בקשות. נסו שוב בעוד דקה.' });
const autoGated = [autoLimiter, requireAuth, requireProduct('seo_autopilot')];
router.get('/truth', ...autoGated, auto.getCard);
router.put('/truth', ...autoGated, auto.putCard);
router.post('/truth/sync', gbpLimiter, requireAuth, requireProduct('seo_autopilot'), auto.syncCard);
router.post('/truth/approve', ...autoGated, auto.approveCard);
// A complete draft landing page from the card. Each call can cost an AI generation: tight limit,
// on top of the monthly creation cap inside the creation code itself.
const pageFromCardLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: 'יותר מדי בקשות. נסו שוב בעוד שעה.' });
router.post('/truth/landing', pageFromCardLimiter, requireAuth, requireProduct('seo_autopilot'), auto.createPageFromCard);
router.get('/truth/phrases', ...autoGated, auto.getPhrases);
router.post('/truth/phrases', gbpLimiter, requireAuth, requireProduct('seo_autopilot'), auto.createPhrasePage);
router.get('/automation', ...autoGated, auto.getSettings);
router.put('/automation', ...autoGated, auto.putSettings);
router.get('/posts', ...autoGated, auto.getPosts);
router.put('/posts/:id', ...autoGated, auto.putPost);
router.post('/posts/:id/publish', gbpLimiter, requireAuth, requireProduct('seo_autopilot'), auto.publishPost);
router.post('/posts/:id/skip', ...autoGated, auto.skipPostNow);
router.get('/activity', ...autoGated, auto.getActivity);

export default router;
