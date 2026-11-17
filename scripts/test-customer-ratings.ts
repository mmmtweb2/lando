// Customer ratings (migration 052). Run: npx tsx scripts/test-customer-ratings.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';

type Row = Record<string, any>;
const db: Record<string, Row[]> = { landing_pages: [], user_products: [], customer_ratings: [], customer_rating_prompts: [] };
let seq = 0;

(async () => {
  const { supabase } = await import('../src/config/supabase');
  (supabase as any).from = (table: string) => {
    const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let conflict: string[] = [];
    if (!db[table]) db[table] = [];
    const rows = () => db[table].filter((r) => f.every((fn) => fn(r)));
    const run = (): any => {
      if (op === 'upsert') {
        const ex = db[table].find((r) => conflict.every((c) => r[c] === patch[c]));
        if (ex) Object.assign(ex, patch); else db[table].push({ id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date(Date.now() + seq).toISOString(), ...patch });
        return { data: null, error: null };
      }
      if (op === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
      return { data: rows(), error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return q; },
      in: (c: string, v: unknown[]) => { f.push((r) => v.includes(r[c])); return q; },
      upsert: (p: Row, o: { onConflict: string }) => { op = 'upsert'; patch = p; conflict = o.onConflict.split(','); return q; },
      update: (p: Row) => { op = 'update'; patch = p; return q; },
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    return q;
  };

  const S = await import('../src/services/customerRatings.service');

  // sanitize / validate
  assert.equal(S.cleanField('  שלום <script>x</script>\n עולם ', 100), 'שלום script x /script עולם');
  assert.equal(S.validateRating({ stars: 6 }).ok, false);
  assert.equal(S.validateRating({ stars: 4, text: 'מעולה, היכנסו ל-www.x.com' }).ok, false, 'links refused');
  assert.equal(S.validateRating({ stars: 4, text: 'התקשרו 052-555-0142' }).ok, false, 'phones refused');
  assert.equal(S.validateRating({ stars: 4, text: 'כתבו ל-a@b.co' }).ok, false, 'emails refused');
  assert.equal(S.validateRating({ stars: 4, text: 'עבד יופי', consentPublish: true }).ok, false, 'consent needs a name');
  const good = S.validateRating({ stars: 5, text: 'עבד יופי', displayName: 'דנה', businessType: 'קוסמטיקאית', consentPublish: true });
  assert.ok(good.ok);
  assert.equal(S.validateRating({ stars: 5, consentPublish: 'true' } as any).ok && (S.validateRating({ stars: 5, consentPublish: 'true' } as any) as any).value.consentPublish, false, 'consent only from a real true');

  // public summary: threshold, approved only, consent for cards
  const mk = (stars: number, status: string, consent: boolean, name = 'שם') => ({ stars, text: 't', display_name: name, business_type: 'b', consent_publish: consent, status, created_at: new Date(Date.now() + stars).toISOString() });
  let sum = S.publicSummary('pages', [mk(5, 'approved', true), mk(4, 'approved', true), mk(1, 'pending', true)]);
  assert.equal(sum.show, false, 'below 3 approved: nothing shown'); assert.deepEqual(sum.ratings, []);
  sum = S.publicSummary('pages', [mk(5, 'approved', true), mk(4, 'approved', false), mk(1, 'approved', true), mk(5, 'rejected', true), mk(5, 'pending', true)]);
  assert.equal(sum.show, true); assert.equal(sum.count, 3); assert.equal(sum.average, 3.3);
  assert.equal(sum.ratings.length, 2, 'only consented cards'); assert.ok(sum.ratings.every((r) => r.name));
  assert.ok(sum.ratings.some((r) => r.stars === 1), 'a low approved rating is shown too');

  // eligibility and the ask
  const E = 'a@x.co';
  let mine = await S.getMine(E);
  assert.equal(mine.products.pages.eligible, false); assert.equal(mine.products.seo.eligible, false);
  await assert.rejects(S.saveMine(E, 'pages', good.ok ? good.value : (null as any)), /אחרי שמשתמשים/);
  db.landing_pages.push({ id: 'p', owner_email: E, status: 'draft' });
  assert.equal((await S.getMine(E)).products.pages.eligible, false, 'a draft is not use');
  db.landing_pages.push({ id: 'p2', owner_email: E, status: 'published' });
  mine = await S.getMine(E);
  assert.equal(mine.products.pages.eligible, true); assert.equal(mine.products.pages.ask, true);
  db.user_products.push({ email: E, product: 'seo_autopilot', started_at: new Date(Date.now() - 5 * 86400000).toISOString() });
  mine = await S.getMine(E);
  assert.equal(mine.products.seo.eligible, true); assert.equal(mine.products.seo.ask, false, 'seo asked only after 30 days');
  db.user_products[0].started_at = new Date(Date.now() - 31 * 86400000).toISOString();
  assert.equal((await S.getMine(E)).products.seo.ask, true);
  await S.dismissAsk(E, 'seo');
  assert.equal((await S.getMine(E)).products.seo.ask, false, 'not now is remembered');

  // save -> pending; update -> back to pending; once rated, no ask
  if (!good.ok) throw new Error('x');
  await S.saveMine(E, 'pages', good.value);
  mine = await S.getMine(E);
  assert.equal(mine.products.pages.ask, false); assert.equal(mine.products.pages.rating!.status, 'pending');
  const row = db.customer_ratings[0];
  assert.equal(row.consent_text, S.CONSENT_TEXT);
  assert.equal(await S.reviewRating(row.id, 'approved'), true);
  await S.saveMine(E, 'pages', { ...good.value, stars: 3 });
  assert.equal(db.customer_ratings.length, 1, 'one rating per account per product');
  assert.equal(db.customer_ratings[0].status, 'pending', 'an edited rating goes back to review');

  // public: approved only
  S._clearRatingsCacheForTests();
  for (const [i, st] of (['approved', 'approved', 'approved', 'pending', 'rejected'] as const).entries()) {
    db.customer_ratings.push({ id: `r${i}`, email: `u${i}@x.co`, product: 'seo', stars: 4, text: 'x', display_name: 'n', business_type: 'b', consent_publish: true, status: st, created_at: new Date().toISOString() });
  }
  const pub = await S.publicRatings('seo');
  assert.equal(pub.show, true); assert.equal(pub.count, 3);

  // admin gate: the ratings admin routes sit behind requireAuth + requireAdmin + panel password
  const adminRouter = (await import('../src/routes/admin.routes')).default as any;
  const stack: any[] = adminRouter.stack;
  const gateAt = stack.findIndex((l) => !l.route && /requireAdminPanelPassword/.test(String(l.name)) || (!l.route && l.handle?.name === 'requireAdminPanelPassword'));
  const ratingsAt = stack.findIndex((l) => l.route?.path === '/ratings');
  assert.ok(ratingsAt > -1, 'admin ratings route exists');
  assert.ok(gateAt > -1 && gateAt < ratingsAt, 'admin ratings route is behind the admin password gate');
  const names = stack.slice(0, ratingsAt).filter((l) => !l.route).map((l) => l.handle?.name);
  assert.ok(names.includes('requireAuth') && names.includes('requireAdmin'), 'and behind requireAuth + requireAdmin');

  console.log('customer ratings checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
