import { Router } from 'express';
import { trackSiteVisit } from '../controllers/site.controller';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

// Public, unauthenticated write endpoint hit by real visitor page-loads —
// same reasoning/shape as landing.routes.ts's trackLimiter: generous enough
// that a legitimate traffic spike (a WhatsApp broadcast, an ad) never gets
// throttled, tight enough to blunt a scripted flood inflating the log.
const siteTrackLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 40,
  message: 'יותר מדי בקשות בזמן קצר. נסו שוב בעוד רגע.',
});

router.post('/track', siteTrackLimiter, trackSiteVisit);

export default router;
