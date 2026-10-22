import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rateLimit';
import { requireProduct } from '../middleware/product.middleware';
import {
  deleteBusiness, getBusinesses, placeAudit, placesAutocomplete, saveBusiness,
} from '../controllers/seo.controller';

const router = Router();

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

export default router;
