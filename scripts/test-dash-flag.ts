// Run: npx tsx scripts/test-dash-flag.ts
// Dashboard v3 is the default; ?dash=v2 / ?dash=v1 (and a remembered v1/v2) opt out, ?dash=v3 opts back in.
import assert from 'node:assert/strict';

function setup(search: string, stored: string | null, throws = false) {
  const store = new Map<string, string>();
  if (stored) store.set('pagey_dash', stored);
  const ls = {
    getItem: (k: string) => { if (throws) throw new Error('blocked'); return store.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (throws) throw new Error('blocked'); store.set(k, v); },
  };
  (globalThis as unknown as { window: unknown }).window = { location: { search }, localStorage: ls };
  return store;
}

async function main() {
  const { dashV3Enabled } = await import('../client/src/dashboard/v3/flag');
  setup('', null);                         assert.equal(dashV3Enabled(), true, 'no flag: v3 is the default');
  setup('?dash=v2', null);                 assert.equal(dashV3Enabled(), false, '?dash=v2 opts out');
  setup('?dash=v1', null);                 assert.equal(dashV3Enabled(), false, '?dash=v1 opts out');
  setup('', 'v2');                         assert.equal(dashV3Enabled(), false, 'remembered v2');
  setup('', 'v1');                         assert.equal(dashV3Enabled(), false, 'remembered v1');
  setup('', 'v3');                         assert.equal(dashV3Enabled(), true, 'remembered v3');
  setup('?dash=v3', 'v2');                 assert.equal(dashV3Enabled(), true, '?dash=v3 wins over a remembered v2');
  const s = setup('?dash=v3', 'v2');       dashV3Enabled(); assert.equal(s.get('pagey_dash'), 'v3', '?dash=v3 is remembered');
  setup('?dash=v2', 'v3');                 assert.equal(dashV3Enabled(), false, '?dash=v2 wins over a remembered v3');
  setup('', null, true);                   assert.equal(dashV3Enabled(), true, 'blocked storage: default v3');
  setup('?dash=v2', null, true);           assert.equal(dashV3Enabled(), false, 'blocked storage, ?dash=v2 still works');
  console.log('dash flag checks passed');
}
main();
