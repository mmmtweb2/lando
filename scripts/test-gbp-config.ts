// Run: npx ts-node --transpile-only scripts/test-gbp-config.ts
import assert from 'node:assert/strict';
import { gbpConfigStatus, gbpEncryptionKey, gbpRedirectUri, GBP_CALLBACK_PATH } from '../src/config/gbp';

const goodKey = 'a'.repeat(64);
const good = {
  GOOGLE_OAUTH_CLIENT_ID: '347917250920-abcdefg.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-abc123_def',
  GBP_TOKEN_ENCRYPTION_KEY: goodKey,
  PUBLIC_API_URL: 'https://api.pagey.co.il',
};
const level = (s: ReturnType<typeof gbpConfigStatus>, key: string) => s.checks.find((c) => c.key === key)!.level;

// 1. empty env: everything missing, not ready
let s = gbpConfigStatus({});
assert.equal(s.ready, false);
assert.equal(level(s, 'GOOGLE_OAUTH_CLIENT_ID'), 'missing');
assert.equal(level(s, 'GOOGLE_OAUTH_CLIENT_SECRET'), 'missing');
assert.equal(level(s, 'GBP_TOKEN_ENCRYPTION_KEY'), 'missing');
assert.equal(level(s, 'redirect URI'), 'missing');
assert.equal(s.redirectUri, null);

// 2. a correct setup is ready and the redirect URI is derived from PUBLIC_API_URL
s = gbpConfigStatus(good);
assert.equal(s.ready, true);
assert.equal(s.redirectUri, 'https://api.pagey.co.il' + GBP_CALLBACK_PATH);
assert.equal(gbpConfigStatus({ ...good, PUBLIC_API_URL: 'https://api.pagey.co.il/' }).redirectUri, 'https://api.pagey.co.il' + GBP_CALLBACK_PATH, 'trailing slash on the base is dropped');

// 3. the secret and the key are NEVER echoed back
const json = JSON.stringify(gbpConfigStatus(good));
assert.ok(!json.includes('GOCSPX-abc123_def'), 'secret must not leak');
assert.ok(!json.includes(goodKey), 'encryption key must not leak');

// 4. typical paste mistakes
assert.equal(level(gbpConfigStatus({ ...good, GOOGLE_OAUTH_CLIENT_ID: good.GOOGLE_OAUTH_CLIENT_ID + '\n' }), 'GOOGLE_OAUTH_CLIENT_ID'), 'bad', 'trailing newline');
assert.equal(level(gbpConfigStatus({ ...good, GOOGLE_OAUTH_CLIENT_SECRET: '"GOCSPX-abc"' }), 'GOOGLE_OAUTH_CLIENT_SECRET'), 'bad', 'quotes');
assert.equal(level(gbpConfigStatus({ ...good, GOOGLE_OAUTH_CLIENT_ID: 'my-client-id' }), 'GOOGLE_OAUTH_CLIENT_ID'), 'bad', 'not a Google client id');
assert.equal(level(gbpConfigStatus({ ...good, GOOGLE_OAUTH_CLIENT_SECRET: 'abcdef' }), 'GOOGLE_OAUTH_CLIENT_SECRET'), 'warn', 'unusual prefix is only a warning');
assert.equal(gbpConfigStatus({ ...good, GOOGLE_OAUTH_CLIENT_SECRET: 'abcdef' }).ready, true, 'warning does not block');

// 5. encryption key must be exactly 64 hex characters
for (const k of ['a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64), 'a'.repeat(32) + ' ' + 'a'.repeat(31)]) {
  assert.equal(level(gbpConfigStatus({ ...good, GBP_TOKEN_ENCRYPTION_KEY: k }), 'GBP_TOKEN_ENCRYPTION_KEY'), 'bad', k.length + ' chars');
  assert.equal(gbpEncryptionKey({ GBP_TOKEN_ENCRYPTION_KEY: k }), null);
}
assert.equal(gbpEncryptionKey({ GBP_TOKEN_ENCRYPTION_KEY: goodKey })!.length, 32);
assert.equal(gbpEncryptionKey({ GBP_TOKEN_ENCRYPTION_KEY: 'A'.repeat(64) })!.length, 32, 'upper-case hex is fine');
assert.match(gbpConfigStatus({ ...good, GBP_TOKEN_ENCRYPTION_KEY: 'a'.repeat(40) }).checks[2].message, /40/, 'says the actual length');

// 6. redirect URI rules
assert.equal(level(gbpConfigStatus({ ...good, PUBLIC_API_URL: 'http://api.pagey.co.il' }), 'redirect URI'), 'bad', 'http is refused');
assert.equal(level(gbpConfigStatus({ ...good, PUBLIC_API_URL: 'http://localhost:3000' }), 'redirect URI'), 'ok', 'http is fine on localhost');
assert.equal(level(gbpConfigStatus({ ...good, GBP_OAUTH_REDIRECT_URI: 'https://api.pagey.co.il/oauth' }), 'redirect URI'), 'bad', 'wrong path');
assert.equal(level(gbpConfigStatus({ ...good, GBP_OAUTH_REDIRECT_URI: 'https://api.pagey.co.il' + GBP_CALLBACK_PATH + '?x=1' }), 'redirect URI'), 'bad', 'query string');
assert.equal(gbpRedirectUri({ GBP_OAUTH_REDIRECT_URI: ' https://x.test' + GBP_CALLBACK_PATH + ' ' }), 'https://x.test' + GBP_CALLBACK_PATH, 'override is trimmed');

console.log('gbp config checks passed');
