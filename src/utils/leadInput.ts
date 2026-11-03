// Validation of the PUBLIC landing-page contact form (POST /api/landing/:id/lead).
// The endpoint is unauthenticated and its content is stored in `leads` and e-mailed to the page
// owner, so every field is type-checked and length-bounded here. Pure: unit-tested.

export const LEAD_LIMITS = { name: 100, phone: 30, email: 254, message: 2000 } as const;
/** Largest request body (bytes) the lead endpoint will look at. Real submissions are < 3 KB. */
export const LEAD_MAX_BODY_BYTES = 10 * 1024;

export interface LeadInput { name: string; phone: string; email: string | null; message: string | null }
export type LeadValidation = { ok: true; value: LeadInput } | { ok: false; error: string };

const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const PHONE_CHARS = /^[0-9+\-\s().*#]+$/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

export function validateLeadInput(body: unknown): LeadValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'בקשה לא תקינה.' };
  const b = body as Record<string, unknown>;

  for (const k of ['name', 'phone'] as const) {
    if (typeof b[k] !== 'string') return { ok: false, error: 'יש למלא שם וטלפון.' };
  }
  for (const k of ['email', 'message'] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== 'string') return { ok: false, error: 'בקשה לא תקינה.' };
  }

  const name = (b.name as string).trim();
  const phone = (b.phone as string).trim();
  if (!name || !phone) return { ok: false, error: 'יש למלא שם וטלפון.' };
  if (name.length > LEAD_LIMITS.name || CONTROL.test(name)) return { ok: false, error: `השם ארוך או לא תקין (עד ${LEAD_LIMITS.name} תווים).` };
  const digits = phone.replace(/\D/g, '').length;
  if (phone.length > LEAD_LIMITS.phone || !PHONE_CHARS.test(phone) || digits < 7 || digits > 15) {
    return { ok: false, error: 'מספר הטלפון אינו תקין.' };
  }

  let email: string | null = null;
  if (typeof b.email === 'string' && b.email.trim()) {
    email = b.email.trim();
    if (email.length > LEAD_LIMITS.email || CONTROL.test(email) || !EMAIL.test(email)) return { ok: false, error: 'כתובת האימייל אינה תקינה.' };
  }

  let message: string | null = null;
  if (typeof b.message === 'string' && b.message.trim()) {
    message = b.message.trim();
    if (message.length > LEAD_LIMITS.message || CONTROL_EXCEPT_NEWLINE.test(message)) {
      return { ok: false, error: `ההודעה ארוכה מדי או לא תקינה (עד ${LEAD_LIMITS.message} תווים).` };
    }
  }
  return { ok: true, value: { name, phone, email, message } };
}
