// Leads captured on the public Audit page (migration 031). Validation is pure and unit-tested;
// the store never throws past its callers' expectations: 'not_migrated' / 'db' are explicit.

import crypto from 'crypto';
import { supabase } from '../config/supabase';

/** The exact wording shown next to the (unticked) consent box. Stored with every lead. */
export const CONSENT_TEXT = 'אני מאשר/ת שיישלח אליי בוואטסאפ קישור הביקורות ותוכנית החיזוק';

export class AuditLeadError extends Error {
  constructor(public code: 'not_migrated' | 'db', message?: string) { super(message ?? code); }
}

/** Israeli MOBILE number -> canonical 05XXXXXXXX, or null. Accepts +972 / 972 / spaces / dashes. */
export function normalizeIlMobile(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 30) return null;
  let d = raw.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(d)) return null;
  d = d.replace(/^\+/, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return /^05\d{8}$/.test(d) ? d : null;
}

/** Trim + collapse whitespace; reject control characters and angle brackets. */
export function cleanText(raw: unknown, min: number, max: number): string | null {
  if (typeof raw !== 'string') return null;
  if (/[\u0000-\u001f\u007f<>]/.test(raw)) return null;
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length >= min && s.length <= max ? s : null;
}

function cleanUtm(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s && s.length <= 80 && /^[\w\-. %+]+$/.test(s) ? s : null;
}

export interface AuditLeadInput {
  name: string;
  phone: string;
  placeId: string;
  businessName: string | null;
  score: number | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export type Validation = { ok: true; value: AuditLeadInput } | { ok: false; error: string; code: 'consent' | 'name' | 'phone' | 'place' };

/** Everything the visitor typed, checked. Consent must be exactly `true`: no consent, no lead. */
export function validateLead(body: Record<string, unknown>, isValidPlaceId: (x: unknown) => boolean): Validation {
  if (body.consent !== true) return { ok: false, code: 'consent', error: 'יש לסמן את תיבת ההסכמה כדי להמשיך.' };
  const name = cleanText(body.name, 2, 60);
  if (!name) return { ok: false, code: 'name', error: 'נא למלא שם (לפחות 2 תווים).' };
  const phone = normalizeIlMobile(body.phone);
  if (!phone) return { ok: false, code: 'phone', error: 'נא למלא מספר נייד ישראלי תקין, למשל 0501234567.' };
  if (!isValidPlaceId(body.placeId)) return { ok: false, code: 'place', error: 'לא זוהה העסק. בחרו עסק ונסו שוב.' };
  const score = typeof body.score === 'number' && Number.isInteger(body.score) && body.score >= 0 && body.score <= 100 ? body.score : null;
  return {
    ok: true,
    value: {
      name, phone, placeId: body.placeId as string,
      businessName: cleanText(body.businessName, 1, 120),
      score,
      utmSource: cleanUtm(body.utm_source), utmMedium: cleanUtm(body.utm_medium), utmCampaign: cleanUtm(body.utm_campaign),
    },
  };
}

export function hashIp(ip: string): string {
  const salt = process.env.AUDIT_IP_SALT || 'pagey-audit';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

function dbError(e: { code?: string; message: string }): AuditLeadError {
  if (e.code === '42P01' || (/audit_leads/.test(e.message) && /does not exist|schema cache/.test(e.message))) {
    return new AuditLeadError('not_migrated');
  }
  console.error('[AUDIT-LEAD] db error:', e.message);
  return new AuditLeadError('db', e.message);
}

/** Saves a lead; the same phone + place within 24h is a repeat tap, not a new lead. */
export async function saveAuditLead(v: AuditLeadInput, ipHash: string | null, now = new Date()): Promise<{ duplicate: boolean }> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data: dup, error: dupErr } = await supabase
    .from('audit_leads').select('id').eq('phone', v.phone).eq('place_id', v.placeId).gte('created_at', since).limit(1);
  if (dupErr) throw dbError(dupErr);
  if ((dup ?? []).length > 0) return { duplicate: true };

  const { error } = await supabase.from('audit_leads').insert({
    name: v.name, phone: v.phone, place_id: v.placeId, business_name: v.businessName, score: v.score,
    consent_at: now.toISOString(), consent_text: CONSENT_TEXT,
    utm_source: v.utmSource, utm_medium: v.utmMedium, utm_campaign: v.utmCampaign, ip_hash: ipHash,
  });
  if (error) throw dbError(error);
  return { duplicate: false };
}

export async function listAuditLeads(limit = 200): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from('audit_leads')
    .select('id, name, phone, place_id, business_name, score, consent_at, utm_source, utm_medium, utm_campaign, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw dbError(error);
  return (data ?? []) as Record<string, unknown>[];
}
