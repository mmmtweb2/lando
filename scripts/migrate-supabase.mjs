#!/usr/bin/env node
/**
 * Supabase -> Supabase migration (region move, e.g. Tokyo -> Frankfurt).
 *
 * The OLD project is only ever READ (read-only DB session, storage list/download only).
 * Everything is written to the NEW project. Run it from your own computer: it needs direct
 * network access to both projects.
 *
 * Phases (run one at a time, or `all`):
 *   check      connectivity, versions, drift report (tables/functions missing in NEW), row counts
 *   reset-new  DROP all tables/functions in NEW public + empty NEW auth users (only for a retry)
 *   schema     apply migrations/*.sql, in order, to NEW
 *   data       copy public tables + auth.users + auth.identities (password hashes are kept)
 *   storage    copy the assets bucket (same paths, same content type)
 *   rewrite    replace the OLD project address with the NEW one in every text/json column of NEW
 *   verify     row counts, bucket counts, RLS flags, RPC functions, no OLD address left
 *
 * Environment (set locally in your shell, never paste into chat):
 *   OLD_DATABASE_URL  NEW_DATABASE_URL        Postgres connection strings (Session pooler or direct)
 *   OLD_SUPABASE_URL  NEW_SUPABASE_URL        https://<ref>.supabase.co
 *   OLD_SERVICE_KEY   NEW_SERVICE_KEY         service_role keys (storage phase and verify only)
 *   SUPABASE_ASSETS_BUCKET                    optional, default page-assets
 *
 * Usage: node scripts/migrate-supabase.mjs <phase> [--skip-missing] [--allow-nonempty]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(here, '..', 'migrations');
const BUCKET = process.env.SUPABASE_ASSETS_BUCKET || 'page-assets';
const RPCS = ['increment_page_view', 'increment_page_cta_click', 'bump_places_usage'];
const PAGE = 500;

const phase = process.argv[2];
const flags = new Set(process.argv.slice(3));

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing environment variable ${name}`); process.exit(2); }
  return v;
}
const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('WARNING:', ...a);
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

function hostOf(url) { try { return new URL(url).host; } catch { return url; } }
function isLocal(url) { const h = hostOf(url); return /^(localhost|127\.|\[::1\])/.test(h) || url.includes('host=/'); }

async function connect(url, { readOnly = false } = {}) {
  const client = new pg.Client({
    connectionString: url,
    ssl: isLocal(url) ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  if (readOnly) await client.query('SET default_transaction_read_only = on');
  return client;
}

const q = (db, text, params) => db.query(text, params);
const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const qual = (schema, table) => `${ident(schema)}.${ident(table)}`;

async function listTables(db, schema) {
  const r = await q(db, `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY 1`, [schema]);
  return r.rows.map((x) => x.table_name);
}

/** Columns that can be written: not generated, not dropped. */
async function writableColumns(db, schema, table) {
  const r = await q(db, `
    SELECT a.attname AS name FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''
    ORDER BY a.attnum`, [schema, table]);
  return r.rows.map((x) => x.name);
}

async function rowCount(db, schema, table) {
  const r = await q(db, `SELECT count(*)::bigint AS n FROM ${qual(schema, table)}`);
  return Number(r.rows[0].n);
}

/** Parents first, so foreign keys hold even without replica mode. */
async function fkOrder(db, tables) {
  const r = await q(db, `
    SELECT cl.relname AS child, pl.relname AS parent
    FROM pg_constraint k JOIN pg_class cl ON cl.oid=k.conrelid JOIN pg_namespace cn ON cn.oid=cl.relnamespace
    JOIN pg_class pl ON pl.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=pl.relnamespace
    WHERE k.contype='f' AND cn.nspname='public' AND pn.nspname='public' AND cl.relname<>pl.relname`);
  const deps = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of r.rows) if (deps.has(child) && deps.has(parent)) deps.get(child).add(parent);
  const done = new Set(); const out = [];
  let progress = true;
  while (out.length < tables.length && progress) {
    progress = false;
    for (const t of tables) {
      if (done.has(t)) continue;
      if ([...deps.get(t)].every((p) => done.has(p))) { done.add(t); out.push(t); progress = true; }
    }
  }
  for (const t of tables) if (!done.has(t)) out.push(t); // cycles: replica mode covers these
  return out;
}

async function copyTable(oldDb, newDb, schema, table) {
  const cols = (await writableColumns(newDb, schema, table));
  const oldCols = new Set(await writableColumns(oldDb, schema, table));
  const common = cols.filter((c) => oldCols.has(c));
  const onlyOld = [...oldCols].filter((c) => !cols.includes(c));
  if (onlyOld.length) warn(`${schema}.${table}: columns only in OLD, not copied: ${onlyOld.join(', ')}`);
  if (!common.length) return 0;
  const colList = common.map(ident).join(', ');
  let copied = 0;
  for (let offset = 0; ; offset += PAGE) {
    const page = await q(oldDb, `SELECT coalesce(json_agg(r), '[]'::json) AS rows FROM (SELECT ${colList} FROM ${qual(schema, table)} ORDER BY ctid LIMIT ${PAGE} OFFSET ${offset}) r`);
    const rows = page.rows[0].rows;
    if (!rows.length) break;
    await q(newDb, `INSERT INTO ${qual(schema, table)} (${colList}) OVERRIDING SYSTEM VALUE SELECT ${colList} FROM json_populate_recordset(null::${qual(schema, table)}, $1::json)`, [JSON.stringify(rows)]);
    copied += rows.length;
    if (rows.length < PAGE) break;
  }
  return copied;
}

async function resetSequences(newDb) {
  const r = await q(newDb, `
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND (column_default LIKE 'nextval(%' OR is_identity='YES')`);
  for (const { table_name, column_name } of r.rows) {
    const seq = await q(newDb, `SELECT pg_get_serial_sequence($1, $2) AS s`, [qual('public', table_name), column_name]);
    if (!seq.rows[0].s) continue;
    await q(newDb, `SELECT setval($1, coalesce((SELECT max(${ident(column_name)}) FROM ${qual('public', table_name)}), 1), (SELECT max(${ident(column_name)}) FROM ${qual('public', table_name)}) IS NOT NULL)`, [seq.rows[0].s]);
  }
}

// ---------------------------------------------------------------- phases

async function phaseCheck() {
  const oldDb = await connect(need('OLD_DATABASE_URL'), { readOnly: true });
  const newDb = await connect(need('NEW_DATABASE_URL'));
  try {
    if (hostOf(process.env.OLD_DATABASE_URL) === hostOf(process.env.NEW_DATABASE_URL)) fail('OLD and NEW point at the same database host.');
    const ov = await q(oldDb, 'select version() v'); const nv = await q(newDb, 'select version() v');
    log('OLD:', ov.rows[0].v.split(',')[0]); log('NEW:', nv.rows[0].v.split(',')[0]);
    const oldT = await listTables(oldDb, 'public'); const newT = await listTables(newDb, 'public');
    log(`OLD public tables: ${oldT.length}   NEW public tables: ${newT.length}`);
    const missing = oldT.filter((t) => !newT.includes(t));
    if (missing.length) log('Tables in OLD that NEW does not have yet (the schema phase will add them if migrations cover them):', missing.join(', '));
    const total = {};
    for (const t of oldT) total[t] = await rowCount(oldDb, 'public', t);
    log('OLD row counts:', JSON.stringify(total));
    const oldAuth = await rowCount(oldDb, 'auth', 'users');
    log('OLD auth.users:', oldAuth, '  NEW auth.users:', await rowCount(newDb, 'auth', 'users'));
    const nonEmpty = [];
    for (const t of newT) if (await rowCount(newDb, 'public', t) > 0) nonEmpty.push(t);
    if (nonEmpty.length) warn('NEW already has data in:', nonEmpty.join(', '), '(use reset-new before a retry)');
    const ext = await q(oldDb, `SELECT extname FROM pg_extension ORDER BY 1`);
    log('OLD extensions:', ext.rows.map((x) => x.extname).join(', '));
    const nxt = await q(newDb, `SELECT extname FROM pg_extension ORDER BY 1`);
    log('NEW extensions:', nxt.rows.map((x) => x.extname).join(', '));
    if (process.env.OLD_SERVICE_KEY && process.env.OLD_SUPABASE_URL) {
      log(`OLD bucket "${BUCKET}" objects:`, await countBucket(createClientFor('OLD')));
    } else warn('Bucket count skipped (set OLD_SUPABASE_URL and OLD_SERVICE_KEY).');
  } finally { await oldDb.end(); await newDb.end(); }
}

async function phaseResetNew() {
  const newDb = await connect(need('NEW_DATABASE_URL'));
  const confirm = process.env.CONFIRM_RESET_NEW;
  const host = hostOf(process.env.NEW_DATABASE_URL);
  if (confirm !== host) fail(`This DELETES everything in NEW public + NEW auth users. Set CONFIRM_RESET_NEW=${host} to proceed.`);
  try {
    for (const t of await listTables(newDb, 'public')) await q(newDb, `DROP TABLE IF EXISTS ${qual('public', t)} CASCADE`);
    const fns = await q(newDb, `SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')`);
    for (const { sig } of fns.rows) await q(newDb, `DROP FUNCTION IF EXISTS ${sig} CASCADE`);
    await q(newDb, 'TRUNCATE auth.identities, auth.users CASCADE');
    log('NEW reset done.');
  } finally { await newDb.end(); }
}

async function phaseSchema() {
  const newDb = await connect(need('NEW_DATABASE_URL'));
  try {
    const existing = await listTables(newDb, 'public');
    if (existing.length && !flags.has('--allow-nonempty')) fail(`NEW already has tables (${existing.length}). Use reset-new first, or --allow-nonempty to try anyway.`);
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
    for (const f of files) {
      process.stdout.write(`  ${f} ... `);
      try { await newDb.query(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')); log('ok'); }
      catch (e) { try { await newDb.query('ROLLBACK'); } catch { /* ignore */ } log('FAILED'); fail(`${f}: ${e.message}`); }
    }
    log(`Applied ${files.length} migrations.`);
  } finally { await newDb.end(); }
}

async function phaseData() {
  const oldDb = await connect(need('OLD_DATABASE_URL'), { readOnly: true });
  const newDb = await connect(need('NEW_DATABASE_URL'));
  try {
    try { await q(newDb, `SET session_replication_role = replica`); log('Triggers/constraints deferred on NEW (replica mode).'); }
    catch (e) { warn('Could not enable replica mode, relying on foreign-key order:', e.message); }
    const oldT = await listTables(oldDb, 'public'); const newT = await listTables(newDb, 'public');
    const missing = oldT.filter((t) => !newT.includes(t));
    if (missing.length && !flags.has('--skip-missing')) fail(`Tables exist in OLD but not NEW (migrations do not create them): ${missing.join(', ')}. Add a migration, or pass --skip-missing to leave them out.`);
    const nonEmpty = [];
    for (const t of newT) if (await rowCount(newDb, 'public', t) > 0) nonEmpty.push(t);
    if (nonEmpty.length && !flags.has('--allow-nonempty')) fail(`NEW already has data in ${nonEmpty.join(', ')}. Run reset-new first.`);
    // auth first (public tables may reference users by email only, but keep users ahead anyway)
    for (const t of ['users', 'identities']) {
      const n = await copyTable(oldDb, newDb, 'auth', t); log(`  auth.${t}: ${n}`);
    }
    const ordered = await fkOrder(newDb, oldT.filter((t) => newT.includes(t)));
    for (const t of ordered) { const n = await copyTable(oldDb, newDb, 'public', t); log(`  public.${t}: ${n}`); }
    await resetSequences(newDb);
    log('Data copied, sequences reset.');
  } finally { await oldDb.end(); await newDb.end(); }
}

function createClientFor(which) {
  return createClient(need(`${which}_SUPABASE_URL`), need(`${which}_SERVICE_KEY`), { auth: { persistSession: false, autoRefreshToken: false } });
}

async function listAll(client, prefix = '') {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.storage.from(BUCKET).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    if (!data.length) break;
    for (const item of data) {
      const p = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null || item.metadata === null) out.push(...await listAll(client, p)); // folder
      else out.push({ path: p, type: item.metadata?.mimetype });
    }
    if (data.length < 100) break;
  }
  return out;
}
async function countBucket(client) { return (await listAll(client)).length; }

async function phaseStorage() {
  const oldC = createClientFor('OLD'); const newC = createClientFor('NEW');
  const { error: be } = await newC.storage.createBucket(BUCKET, {
    public: true, fileSizeLimit: 10 * 1024 * 1024, allowedMimeTypes: ['image/webp', 'image/png', 'image/jpeg'],
  });
  if (be && !/already exists|duplicate/i.test(be.message)) fail(`create bucket: ${be.message}`);
  const files = await listAll(oldC);
  log(`Copying ${files.length} object(s) from OLD bucket "${BUCKET}"...`);
  let n = 0;
  for (const f of files) {
    const { data, error } = await oldC.storage.from(BUCKET).download(f.path);
    if (error) fail(`download ${f.path}: ${error.message}`);
    const buf = Buffer.from(await data.arrayBuffer());
    const { error: ue } = await newC.storage.from(BUCKET).upload(f.path, buf, { contentType: f.type || data.type || 'image/webp', upsert: true });
    if (ue) fail(`upload ${f.path}: ${ue.message}`);
    if (++n % 20 === 0) log(`  ${n}/${files.length}`);
  }
  log(`Storage copied: ${n} object(s).`);
}

async function textColumns(db) {
  const r = await q(db, `
    SELECT table_name, column_name, data_type, udt_name FROM information_schema.columns
    WHERE table_schema='public' AND (data_type IN ('text','character varying','json','jsonb') OR udt_name IN ('_text','_varchar'))
      AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')
    ORDER BY 1,2`);
  return r.rows;
}

function exprs(c, from, to) {
  const col = ident(c.column_name);
  const f = from.replace(/'/g, "''"); const t = to.replace(/'/g, "''");
  if (c.data_type === 'jsonb') return { has: `${col}::text LIKE '%${f}%'`, set: `replace(${col}::text, '${f}', '${t}')::jsonb` };
  if (c.data_type === 'json') return { has: `${col}::text LIKE '%${f}%'`, set: `replace(${col}::text, '${f}', '${t}')::json` };
  if (c.data_type === 'ARRAY') return { has: `${col}::text LIKE '%${f}%'`, set: `array(SELECT replace(x, '${f}', '${t}') FROM unnest(${col}) x)` };
  return { has: `${col} LIKE '%${f}%'`, set: `replace(${col}, '${f}', '${t}')` };
}

async function phaseRewrite() {
  const from = need('OLD_SUPABASE_URL').replace(/\/+$/, ''); const to = need('NEW_SUPABASE_URL').replace(/\/+$/, '');
  const newDb = await connect(need('NEW_DATABASE_URL'));
  try {
    await q(newDb, `SET session_replication_role = replica`).catch(() => {});
    let total = 0;
    for (const c of await textColumns(newDb)) {
      const e = exprs(c, from, to);
      const r = await q(newDb, `UPDATE ${qual('public', c.table_name)} SET ${ident(c.column_name)} = ${e.set} WHERE ${e.has}`);
      if (r.rowCount) { log(`  ${c.table_name}.${c.column_name}: ${r.rowCount} row(s)`); total += r.rowCount; }
    }
    log(`Rewrote the old project address in ${total} row(s).`);
  } finally { await newDb.end(); }
}

async function phaseVerify() {
  const from = need('OLD_SUPABASE_URL').replace(/\/+$/, '');
  const oldDb = await connect(need('OLD_DATABASE_URL'), { readOnly: true });
  const newDb = await connect(need('NEW_DATABASE_URL'));
  let bad = 0;
  const check = (ok, msg) => { log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) bad++; };
  try {
    const oldT = await listTables(oldDb, 'public'); const newT = await listTables(newDb, 'public');
    for (const t of oldT) {
      if (!newT.includes(t)) { check(false, `table ${t} missing in NEW`); continue; }
      const a = await rowCount(oldDb, 'public', t); const b = await rowCount(newDb, 'public', t);
      check(a === b, `rows ${t}: OLD ${a} / NEW ${b}`);
    }
    for (const t of ['users', 'identities']) {
      const a = await rowCount(oldDb, 'auth', t); const b = await rowCount(newDb, 'auth', t);
      check(a === b, `rows auth.${t}: OLD ${a} / NEW ${b}`);
    }
    const hashes = await q(newDb, `SELECT count(*)::int n FROM auth.users WHERE encrypted_password IS NULL OR encrypted_password=''`);
    const oldHashes = await q(oldDb, `SELECT count(*)::int n FROM auth.users WHERE encrypted_password IS NULL OR encrypted_password=''`);
    check(hashes.rows[0].n === oldHashes.rows[0].n, `users without password hash: OLD ${oldHashes.rows[0].n} / NEW ${hashes.rows[0].n}`);
    const rls = async (db) => (await q(db, `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1`)).rows;
    const oldR = await rls(oldDb); const newR = await rls(newDb);
    const diffR = oldR.filter((o) => newR.find((n) => n.relname === o.relname)?.relrowsecurity !== o.relrowsecurity).map((o) => o.relname);
    check(diffR.length === 0, `row level security matches OLD on every table${diffR.length ? ' (differs: ' + diffR.join(', ') + ')' : ''}`);
    const noRls = newR.filter((n) => !n.relrowsecurity).map((n) => n.relname);
    if (noRls.length) warn('NEW tables without RLS:', noRls.join(', '));
    for (const fn of RPCS) {
      const r = await q(newDb, `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=$1`, [fn]);
      check(r.rowCount > 0, `function ${fn} exists in NEW`);
    }
    const fnOld = (await q(oldDb, `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY 1`)).rows.map((x) => x.proname);
    const fnNew = new Set((await q(newDb, `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`)).rows.map((x) => x.proname));
    const fnMiss = fnOld.filter((f) => !fnNew.has(f));
    check(fnMiss.length === 0, `all public functions of OLD exist in NEW${fnMiss.length ? ' (missing: ' + fnMiss.join(', ') + ')' : ''}`);
    let leftovers = 0;
    for (const c of await textColumns(newDb)) {
      const e = exprs(c, from, 'x');
      const r = await q(newDb, `SELECT count(*)::int n FROM ${qual('public', c.table_name)} WHERE ${e.has}`);
      if (r.rows[0].n) { log(`  old address still in ${c.table_name}.${c.column_name}: ${r.rows[0].n}`); leftovers += r.rows[0].n; }
    }
    check(leftovers === 0, 'no OLD project address left in NEW');
    if (process.env.OLD_SERVICE_KEY && process.env.NEW_SERVICE_KEY) {
      const a = await countBucket(createClientFor('OLD')); const b = await countBucket(createClientFor('NEW'));
      check(a === b, `bucket "${BUCKET}" objects: OLD ${a} / NEW ${b}`);
    } else warn('Storage count skipped (set OLD_SERVICE_KEY and NEW_SERVICE_KEY).');
  } finally { await oldDb.end(); await newDb.end(); }
  log(bad ? `\n${bad} check(s) FAILED.` : '\nAll checks passed.');
  process.exit(bad ? 1 : 0);
}

const phases = { check: phaseCheck, 'reset-new': phaseResetNew, schema: phaseSchema, data: phaseData, storage: phaseStorage, rewrite: phaseRewrite, verify: phaseVerify };
if (phase === 'all') {
  for (const p of ['check', 'schema', 'data', 'storage', 'rewrite', 'verify']) { log(`\n=== ${p} ===`); await phases[p](); }
} else if (phases[phase]) {
  await phases[phase]();
} else {
  console.error(`Usage: node scripts/migrate-supabase.mjs <${Object.keys(phases).join('|')}|all> [--skip-missing] [--allow-nonempty]`);
  process.exit(2);
}
