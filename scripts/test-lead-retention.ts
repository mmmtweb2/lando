// Run: npx tsx scripts/test-lead-retention.ts — free-check leads are deleted after 30 days; an ended
// subscription's included page can be bought back the regular way (decisions 17.11).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';

(async () => {
  const { supabase } = await import('../src/config/supabase');
  const calls: { op: string; col?: string; val?: string }[] = [];
  (supabase as any).from = (_t: string) => {
    const q: any = {
      delete: () => { calls.push({ op: 'delete' }); return q; },
      lt: (col: string, val: string) => { calls.push({ op: 'lt', col, val }); return q; },
      select: () => Promise.resolve({ data: [{ id: 'a' }, { id: 'b' }], error: null }),
    };
    return q;
  };
  const { purgeOldAuditLeads, AUDIT_LEAD_RETENTION_DAYS } = await import('../src/services/auditLeads.service');
  assert.equal(AUDIT_LEAD_RETENTION_DAYS, 30);
  const now = new Date('2026-11-17T10:00:00Z');
  const n = await purgeOldAuditLeads(now);
  assert.equal(n, 2);
  const lt = calls.find((c) => c.op === 'lt')!;
  assert.equal(lt.col, 'created_at');
  assert.equal(lt.val, '2026-10-18T10:00:00.000Z', 'cutoff is exactly 30 days back');
  console.log('lead retention checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
