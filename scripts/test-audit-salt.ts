// Run: npx tsx scripts/test-audit-salt.ts
// hashIp must never use a constant salt that is visible in the source.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'placeholder';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
// require (not import) so the placeholder env above is set before supabase.ts loads, under any TS runner.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { _resetAuditSaltForTests, hashIp, warnIfAuditSaltMissing } = require('../src/services/auditLeads.service') as typeof import('../src/services/auditLeads.service');

const warns: string[] = []; const origWarn = console.warn; console.warn = (...a: unknown[]) => { warns.push(a.join(' ')); };
const legacy = (ip: string) => crypto.createHash('sha256').update(`pagey-audit:${ip}`).digest('hex').slice(0, 32);

// 1. explicit salt: no warning, deterministic
delete process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.AUDIT_IP_SALT = 'my-random-salt'; _resetAuditSaltForTests();
warnIfAuditSaltMissing(); assert.equal(warns.length, 0);
const a = hashIp('1.2.3.4'); assert.match(a, /^[0-9a-f]{32}$/); assert.equal(hashIp('1.2.3.4'), a); assert.notEqual(hashIp('1.2.3.5'), a);
assert.notEqual(a, legacy('1.2.3.4'));

// 2. no salt, service-role key present: derived (not the legacy constant), stable, one warning
delete process.env.AUDIT_IP_SALT; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-1'; _resetAuditSaltForTests();
warnIfAuditSaltMissing(); warnIfAuditSaltMissing();
assert.equal(warns.length, 2); // each explicit startup call warns; index.ts calls it exactly once
const d1 = hashIp('1.2.3.4'); assert.notEqual(d1, legacy('1.2.3.4'), 'constant salt is gone'); assert.notEqual(d1, a);
assert.equal(hashIp('1.2.3.4'), d1);
assert.ok(!warns.join('\n').includes('service-key-1'), 'the secret is never logged');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-2'; _resetAuditSaltForTests();
assert.notEqual(hashIp('1.2.3.4'), d1, 'different secret -> different salt');

// 3. nothing at all: does not throw, random salt
delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; _resetAuditSaltForTests();
warns.length = 0; warnIfAuditSaltMissing(); assert.equal(warns.length, 1);
assert.match(hashIp('1.2.3.4'), /^[0-9a-f]{32}$/); assert.notEqual(hashIp('1.2.3.4'), legacy('1.2.3.4'));

console.warn = origWarn;
console.log('test-audit-salt: OK');
