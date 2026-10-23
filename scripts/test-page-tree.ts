// Run: npx ts-node --transpile-only scripts/test-page-tree.ts
// Stage 9.1 — deleting a PARENT page whose CHILD page has leads.
// leads.landing_page_id has no ON DELETE clause, so the leads of the whole tree must go first;
// children then go with the parent through landing_pages.parent_id ON DELETE CASCADE.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { deleteLeadsForPageTree } from '../src/services/pageTree.service';
import { supabase } from '../src/config/supabase';

const db: Record<string, any[]> = {
  landing_pages: [
    { id: 'P', parent_id: null }, { id: 'C1', parent_id: 'P' }, { id: 'C2', parent_id: 'P' },
    { id: 'OTHER', parent_id: null }, { id: 'OC', parent_id: 'OTHER' },
  ],
  leads: [
    { id: 1, landing_page_id: 'P' }, { id: 2, landing_page_id: 'C1' }, { id: 3, landing_page_id: 'C1' },
    { id: 4, landing_page_id: 'OTHER' }, { id: 5, landing_page_id: 'OC' },
  ],
};
let failChildren = false;
(supabase as any).from = (table: string) => {
  const f: Array<(r: any) => boolean> = []; let op = 'select';
  const q: any = {
    select: () => q,
    eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return q; },
    in: (k: string, vs: unknown[]) => { f.push(r => vs.includes(r[k])); return q; },
    delete: () => { op = 'delete'; return q; },
    then: (ok: any) => {
      if (table === 'landing_pages' && failChildren) return ok({ data: null, error: { message: 'boom' } });
      const m = db[table].filter(r => f.every(fn => fn(r)));
      if (op === 'delete') db[table] = db[table].filter(r => !m.includes(r));
      return ok({ data: m, error: null });
    },
  };
  return q;
};

(async () => {
  failChildren = true;
  assert.equal(await deleteLeadsForPageTree('P'), 'boom', 'lookup failure is returned (the caller must NOT delete the page)');
  assert.equal(db.leads.length, 5, 'nothing deleted on failure');

  failChildren = false;
  assert.equal(await deleteLeadsForPageTree('P'), null);
  assert.deepEqual(db.leads.map(l => l.id), [4, 5], 'leads of the parent AND its children removed; other accounts untouched');

  assert.equal(await deleteLeadsForPageTree('NO_LEADS'), null, 'a page without leads is fine');
  console.log('page tree checks passed');
})().catch(e => { console.error(e); process.exit(1); });
