// ─────────────────────────────────────────────────────────────────────────────
// draftCleanup.service.ts — abandoned-draft lifecycle (migration 023).
//
//   day 1   reminder   |  day 7   reminder
//   day 30  final warning ("deleted in 7 days")
//   day 37  delete the draft (leads first — FK has no cascade — then the page)
//
// Measured from `draft_clock_at`. Only rows with status = 'draft' are touched;
// every write is a compare-and-swap, so a page published mid-sweep is never
// emailed or deleted. Called from the same 6h sweep timer as the renewal
// lifecycle (startRenewalSweep).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../config/supabase';
import { sendDraftReminder, DraftReminderKind } from './draft.mailer';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 200;

export const DRAFT_DELETE_DAYS = 37;

/** MOST URGENT FIRST: sending one marks every less-urgent stage handled too. */
const STAGES: { kind: DraftReminderKind; days: number; column: string }[] = [
  { kind: 'day30', days: 30, column: 'draft_warning_30d_at' },
  { kind: 'day7',  days: 7,  column: 'draft_reminder_7d_at' },
  { kind: 'day1',  days: 1,  column: 'draft_reminder_1d_at' },
];

interface DraftRow {
  id: string;
  business_name: string | null;
  owner_email: string | null;
  draft_reminder_1d_at: string | null;
  draft_reminder_7d_at: string | null;
  draft_warning_30d_at: string | null;
}

async function sendDueDraftReminders(now: Date): Promise<number> {
  let sent = 0;

  for (let i = 0; i < STAGES.length; i++) {
    const { kind, days, column } = STAGES[i];
    const lessUrgent = STAGES.slice(i + 1).map((s) => s.column);
    const threshold = new Date(now.getTime() - days * DAY_MS);

    const { data, error } = await supabase
      .from('landing_pages')
      .select('id, business_name, owner_email, draft_reminder_1d_at, draft_reminder_7d_at, draft_warning_30d_at')
      .eq('status', 'draft')
      .is(column, null)
      .lte('draft_clock_at', threshold.toISOString())
      .limit(BATCH_LIMIT);

    if (error) {
      console.error(`[DRAFTS] reminder query failed (${kind}):`, error.message);
      continue;
    }

    for (const row of (data ?? []) as DraftRow[]) {
      const stamp = new Date().toISOString();
      const marks: Record<string, string> = { [column]: stamp };
      for (const c of lessUrgent) {
        if (!(row as unknown as Record<string, string | null>)[c]) marks[c] = stamp;
      }

      // Claim atomically; only the pass that flips NULL → timestamp sends.
      const { data: claimed, error: claimErr } = await supabase
        .from('landing_pages')
        .update(marks)
        .eq('id', row.id)
        .eq('status', 'draft')
        .is(column, null)
        .select('id')
        .maybeSingle();

      if (claimErr) {
        console.error(`[DRAFTS] claim failed (${kind}) for ${row.id}:`, claimErr.message);
        continue;
      }
      if (!claimed || !row.owner_email) continue;

      const ok = await sendDraftReminder({
        kind,
        to: row.owner_email,
        businessName: row.business_name ?? 'העסק שלך',
      });
      if (ok) sent++;
    }
  }

  return sent;
}

async function deleteAbandonedDrafts(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DRAFT_DELETE_DAYS * DAY_MS);

  const { data, error } = await supabase
    .from('landing_pages')
    .select('id, slug, owner_email')
    .eq('status', 'draft')
    .lte('draft_clock_at', cutoff.toISOString())
    .limit(BATCH_LIMIT);

  if (error) {
    console.error('[DRAFTS] delete query failed:', error.message);
    return 0;
  }

  let deleted = 0;
  for (const row of (data ?? []) as { id: string; slug: string; owner_email: string | null }[]) {
    // Leads first — leads_landing_page_id_fkey has no ON DELETE clause.
    const { error: leadsErr } = await supabase.from('leads').delete().eq('landing_page_id', row.id);
    if (leadsErr) {
      console.error('[DRAFTS] leads delete failed — draft kept, retry next sweep', { id: row.id, error: leadsErr.message });
      continue;
    }

    // Page second, still guarded on 'draft' so a just-published page survives.
    const { data: gone, error: pageErr } = await supabase
      .from('landing_pages')
      .delete()
      .eq('id', row.id)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle();

    if (pageErr) {
      console.error('[DRAFTS] page delete failed', { id: row.id, error: pageErr.message });
      continue;
    }
    if (!gone) continue; // published in the meantime — nothing deleted

    deleted++;
    console.warn('[DRAFTS] deleted abandoned draft', { id: row.id, slug: row.slug });
  }

  return deleted;
}

export async function runDraftSweep(): Promise<{ reminded: number; deleted: number }> {
  const now = new Date();
  const reminded = await sendDueDraftReminders(now);
  const deleted = await deleteAbandonedDrafts(now);
  if (reminded || deleted) console.log('[DRAFTS] draft sweep done', { reminded, deleted });
  return { reminded, deleted };
}
