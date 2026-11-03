// Runs every scripts/test-*.ts with `npx tsx` (tsx, not ts-node: some tests import ES modules
// from the client). Exits non-zero if any script fails. Usage: npm test
// Dummy Supabase env is supplied ONLY when missing, because tsx hoists imports above the
// `process.env.X ??= ...` lines inside the scripts and the config module throws at import time.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, '..');
const only = process.argv.slice(2);
const files = readdirSync(dir)
  .filter((f) => /^test-.*\.ts$/.test(f))
  .filter((f) => only.length === 0 || only.some((o) => f.includes(o)))
  .sort();

const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
  ...process.env,
};

const failed = [];
for (const f of files) {
  const started = Date.now();
  const r = spawnSync('npx', ['tsx', join('scripts', f)], {
    cwd: root, env, encoding: 'utf8', timeout: 180_000, shell: process.platform === 'win32',
  });
  const ok = r.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${f}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (!ok) {
    failed.push(f);
    process.stdout.write(`${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}\n` : ''}`);
  }
}
console.log(`\n${files.length - failed.length}/${files.length} test scripts passed`);
if (failed.length) { console.error(`Failed: ${failed.join(', ')}`); process.exit(1); }
if (files.length === 0) { console.error('No test scripts found'); process.exit(1); }
