// Friendly Hebrew messages for authentication errors. The raw (English, technical) message from the
// auth provider is never shown to the customer: anything we do not recognise becomes `fallback`.
export function translateAuthError(err: unknown, fallback = 'שגיאת התחברות, נסו שוב'): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (/invalid login credentials/i.test(msg)) return 'אימייל או סיסמה שגויים';
  if (/already registered|already exists/i.test(msg)) return 'כתובת המייל כבר רשומה — נסו להתחבר';
  if (/password should be at least/i.test(msg)) return 'הסיסמה חייבת להכיל לפחות 6 תווים';
  if (/should be different from the old password|same as the old password/i.test(msg)) return 'הסיסמה החדשה צריכה להיות שונה מהקודמת';
  if (/weak password|password is too weak|easy to guess/i.test(msg)) return 'הסיסמה חלשה מדי. בחרו סיסמה ארוכה וייחודית יותר';
  if (/email not confirmed/i.test(msg)) return 'יש לאשר קודם את כתובת המייל (בדקו את תיבת הדואר)';
  if (/session (missing|expired)|not authenticated|jwt expired|invalid jwt/i.test(msg)) return 'פג תוקף ההתחברות. התחברו מחדש ונסו שוב';
  if (/rate limit|too many|security purposes/i.test(msg)) return 'בוצעו יותר מדי ניסיונות. המתינו כמה דקות ונסו שוב';
  if (/failed to fetch|network|load failed/i.test(msg)) return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב';
  if (/invalid.*email|unable to validate email/i.test(msg)) return 'נא להזין כתובת אימייל תקינה';
  if (/signups? not allowed|signup.*disabled/i.test(msg)) return 'ההרשמה אינה זמינה כרגע. נסו שוב מאוחר יותר';
  return fallback;
}

/** Supabase's minimum password length (Authentication → Providers → Email). */
export const MIN_PASSWORD_LEN = 6;

/**
 * Client-side password check before calling Supabase. QA 24.11: an empty password got the same
 * "at least 6 characters" message as a short one; an empty field now says so. null = fine.
 */
export function passwordError(pw: string): string | null {
  if (pw.trim().length === 0) return 'נא להזין סיסמה';
  if (pw.length < MIN_PASSWORD_LEN) return `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD_LEN} תווים`;
  return null;
}
