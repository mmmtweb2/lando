// Opting out of the abandoned-draft reminder emails (draft.mailer.ts). Those reminders reach accounts
// that never paid and urge them to publish, so every one carries a one-click unsubscribe link: the same
// signed token as the monthly digest (DIGEST_SECRET), scoped to its own purpose. Stored in
// seo_email_prefs.draft_reminders (migration 049). No row, or the column not there yet = on.

import { supabase } from '../config/supabase';
import { signUnsub, verifyUnsub } from './digest.service';

const PURPOSE = 'draft-unsub';
const API_URL = (process.env.PUBLIC_API_URL || process.env.PUBLIC_APP_URL || 'https://pagey.co.il').replace(/\/$/, '');

/** The unsubscribe link for this address, or null when no DIGEST_SECRET is set (then no link is shown). */
export function draftUnsubUrl(email: string, secret = process.env.DIGEST_SECRET ?? ''): string | null {
  if (!secret) return null;
  return `${API_URL}/api/users/email/drafts/unsubscribe?t=${signUnsub(email, secret, PURPOSE)}`;
}

export function verifyDraftUnsub(token: unknown, secret = process.env.DIGEST_SECRET ?? ''): string | null {
  return verifyUnsub(token, secret, PURPOSE);
}

export async function setDraftReminders(email: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('seo_email_prefs')
    .upsert({ email, draft_reminders: on, updated_at: new Date().toISOString() }, { onConflict: 'email' });
  if (error) throw new Error(error.message);
}

/**
 * Which of these addresses asked not to get draft reminders. A read error (e.g. migration 049 not run)
 * returns an empty set: nobody could have opted out yet, since saving the choice needs the same column.
 */
export async function draftOptedOut(emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set();
  const { data, error } = await supabase.from('seo_email_prefs').select('email').eq('draft_reminders', false).in('email', emails);
  if (error) return new Set();
  return new Set(((data ?? []) as Array<{ email: string }>).map((r) => r.email));
}
