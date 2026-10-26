import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimit';
import { publicAudit, publicConfig, publicLead, publicSearch } from '../controllers/publicAudit.controller';

// PUBLIC routes (no login) for /audit. Per-IP limits here; the global daily budget lives in
// services/publicAuditGuard.ts. 10 audits and 30 searches per IP per hour (Avi, task #1).
const router = Router();
const HOUR = 60 * 60 * 1000;

const searchLimiter = rateLimit({ windowMs: HOUR, max: 30, message: 'הגעתם למגבלת החיפושים לשעה. נסו שוב מאוחר יותר.' });
const auditLimiter = rateLimit({ windowMs: HOUR, max: 10, message: 'הגעתם למגבלת הבדיקות לשעה. נסו שוב מאוחר יותר.' });
const leadLimiter = rateLimit({ windowMs: HOUR, max: 10, message: 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.' });
const configLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, message: 'יותר מדי בקשות.' });

router.get('/config', configLimiter, publicConfig);
router.post('/audit/search', searchLimiter, publicSearch);
router.get('/audit/:placeId', auditLimiter, publicAudit);
router.post('/audit/lead', leadLimiter, publicLead);

export default router;
