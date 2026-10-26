import { Request, Response } from 'express';
import {
  PlacesError, auditPlace, autocompleteBusinesses, isValidPlaceId, placesConfigured,
} from '../services/places.service';
import { Take, publicAuditDailyCap, takeAudit, takeLead, takeSearch } from '../services/publicAuditGuard';
import {
  AuditLeadError, CONSENT_TEXT, hashIp, listAuditLeads, saveAuditLead, validateLead,
} from '../services/auditLeads.service';

// Public (no login) Audit, task #1. These handlers WRAP the same services the dashboard uses
// (autocompleteBusinesses / auditPlace), so the public score is the dashboard score by construction.

/** Concierge WhatsApp number from env (international digits only), or null = hide the button. */
export function conciergeNumber(): string | null {
  const d = (process.env.CONCIERGE_WHATSAPP ?? '').replace(/[^\d]/g, '');
  return d.length >= 9 && d.length <= 15 ? d : null;
}

/** GET /api/public/config — what the public pages need to know. */
export function publicConfig(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    auditEnabled: publicAuditDailyCap() > 0 && placesConfigured(),
    concierge: conciergeNumber(),
    consentText: CONSENT_TEXT,
  });
}

/** Maps a guard verdict to a response. Returns true when the request must stop here. */
function blocked(take: Take, res: Response): boolean {
  if (take === 'ok') return false;
  if (take === 'disabled') {
    res.status(503).json({ error: 'הבדיקה החינמית תהיה זמינה בקרוב.', code: 'public_audit_disabled' });
  } else {
    res.status(429).json({ error: 'המערכת עמוסה כרגע, נסו שוב מחר.', code: 'daily_cap' });
  }
  return true;
}

function placesFail(res: Response, e: unknown): void {
  if (e instanceof PlacesError) {
    switch (e.code) {
      case 'not_configured':
        res.status(503).json({ error: 'הבדיקה החינמית תהיה זמינה בקרוב.', code: 'public_audit_disabled' }); return;
      case 'bad_request': res.status(400).json({ error: 'הבקשה לא תקינה.' }); return;
      case 'not_found': res.status(404).json({ error: 'העסק לא נמצא.' }); return;
      default: res.status(502).json({ error: 'גוגל לא הגיבה. נסו שוב בעוד רגע.' }); return;
    }
  }
  console.error('[PUBLIC-AUDIT] unexpected:', e);
  res.status(500).json({ error: 'שגיאה פנימית.' });
}

/** POST /api/public/audit/search { input, sessionToken? } */
export async function publicSearch(req: Request, res: Response): Promise<void> {
  const { input, sessionToken } = req.body ?? {};
  if (typeof input !== 'string') { res.status(400).json({ error: 'חסר טקסט לחיפוש.' }); return; }
  if (!placesConfigured()) { placesFail(res, new PlacesError('not_configured', '')); return; }
  if (input.trim().length < 2) { res.json({ suggestions: [] }); return; }   // costs nothing, spends nothing
  if (blocked(takeSearch(), res)) return;
  try {
    res.json({ suggestions: await autocompleteBusinesses(input, typeof sessionToken === 'string' ? sessionToken : undefined) });
  } catch (e) { placesFail(res, e); }
}

/** GET /api/public/audit/:placeId */
export async function publicAudit(req: Request, res: Response): Promise<void> {
  const { placeId } = req.params;
  if (!isValidPlaceId(placeId)) { res.status(400).json({ error: 'מזהה עסק לא תקין.' }); return; }
  if (!placesConfigured()) { placesFail(res, new PlacesError('not_configured', '')); return; }
  if (blocked(takeAudit(), res)) return;
  try {
    res.json({ audit: await auditPlace(placeId) });
  } catch (e) { placesFail(res, e); }
}

/**
 * POST /api/public/audit/lead — name + Israeli mobile + place, ONLY with consent === true.
 * A filled honeypot field answers like a success and stores nothing.
 */
export async function publicLead(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.website === 'string' && body.website.trim() !== '') { res.json({ ok: true }); return; }
  const v = validateLead(body, isValidPlaceId);
  if (!v.ok) { res.status(400).json({ error: v.error, code: v.code }); return; }
  if (takeLead() === 'cap') { res.status(429).json({ error: 'המערכת עמוסה כרגע, נסו שוב מחר.', code: 'daily_cap' }); return; }
  try {
    const { duplicate } = await saveAuditLead(v.value, hashIp(req.ip || 'unknown'));
    res.status(duplicate ? 200 : 201).json({
      ok: true,
      reviewUrl: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(v.value.placeId)}`,
    });
  } catch (e) {
    if (e instanceof AuditLeadError && e.code === 'not_migrated') {
      res.status(503).json({ error: 'לא הצלחנו לשמור כרגע. נסו שוב מאוחר יותר.', code: 'leads_unavailable' });
      return;
    }
    console.error('[AUDIT-LEAD] save failed:', e);
    res.status(500).json({ error: 'לא הצלחנו לשמור כרגע. נסו שוב.' });
  }
}

/** GET /api/admin/audit-leads — admin panel list. */
export async function adminAuditLeads(_req: Request, res: Response): Promise<void> {
  try {
    res.json({ leads: await listAuditLeads(200) });
  } catch (e) {
    if (e instanceof AuditLeadError && e.code === 'not_migrated') { res.json({ leads: [], notMigrated: true }); return; }
    console.error('[AUDIT-LEAD] admin list failed:', e);
    res.status(500).json({ error: 'שגיאה פנימית.' });
  }
}
