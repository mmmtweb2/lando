// Run: npx tsx scripts/test-client-ip.ts
// CF-Connecting-IP trust decision (src/utils/clientIp.ts).
import assert from 'node:assert/strict';
import {
  applyCloudflareIp, cfConnectingIp, isCloudflareIp, isPrivateIp, lastForwardedFor, normalizeIp, shouldTrustCfHeader,
} from '../src/utils/clientIp';

// ── ranges ──
assert.equal(isCloudflareIp('173.245.48.1'), true);
assert.equal(isCloudflareIp('104.16.0.1'), true);
assert.equal(isCloudflareIp('104.23.255.255'), true);
assert.equal(isCloudflareIp('172.71.1.1'), true);          // 172.64.0.0/13
assert.equal(isCloudflareIp('131.0.72.9'), true);
assert.equal(isCloudflareIp('2606:4700::1'), true);
assert.equal(isCloudflareIp('2a06:98c0::1'), true);
assert.equal(isCloudflareIp('::ffff:162.158.1.1'), true);  // IPv4-mapped
assert.equal(isCloudflareIp('1.2.3.4'), false);
assert.equal(isCloudflareIp('104.32.0.1'), false);         // just outside 104.24.0.0/14
assert.equal(isCloudflareIp('172.72.0.1'), false);         // just outside 172.64.0.0/13
assert.equal(isCloudflareIp('2001:db8::1'), false);
assert.equal(isCloudflareIp('garbage'), false);
assert.equal(isCloudflareIp(undefined), false);
assert.equal(isPrivateIp('172.18.0.4'), true);              // docker network (Traefik)
assert.equal(isPrivateIp('127.0.0.1'), true);
assert.equal(isPrivateIp('::1'), true);
assert.equal(isPrivateIp('::ffff:10.0.0.5'), true);
assert.equal(isPrivateIp('8.8.8.8'), false);
assert.equal(isPrivateIp('173.245.48.1'), false);

// ── parsing ──
assert.equal(normalizeIp(' [2606:4700::1] '), '2606:4700::1');
assert.equal(normalizeIp('1.2.3.4%eth0'), '1.2.3.4');
assert.equal(normalizeIp('1.2.3.4, 5.6.7.8'), null);
assert.equal(lastForwardedFor('9.9.9.9, 173.245.48.1'), '173.245.48.1');
assert.equal(lastForwardedFor(['9.9.9.9', ' 8.8.8.8 ']), '8.8.8.8');
assert.equal(lastForwardedFor(undefined), null);
assert.equal(cfConnectingIp('203.0.113.7'), '203.0.113.7');
assert.equal(cfConnectingIp('not-an-ip'), null);

const T = (o: Partial<Parameters<typeof shouldTrustCfHeader>[0]>) =>
  shouldTrustCfHeader({ remoteAddress: undefined, xForwardedFor: undefined, trustProxy: true, ...o });

// ── trust decision ──
// Peer is Cloudflare itself (origin directly behind CF).
assert.equal(T({ remoteAddress: '173.245.48.9' }), true);
assert.equal(T({ remoteAddress: '::ffff:173.245.48.9' }), true);
// Peer is OUR proxy (Traefik, private) and it saw Cloudflare as its peer: the production layout.
assert.equal(T({ remoteAddress: '172.18.0.4', xForwardedFor: '173.245.48.9' }), true);
assert.equal(T({ remoteAddress: '172.18.0.4', xForwardedFor: '203.0.113.7, 173.245.48.9' }), true);
// Spoof attempts: client hits the proxy/origin directly and forges XFF / the header.
assert.equal(T({ remoteAddress: '172.18.0.4', xForwardedFor: '173.245.48.9, 198.51.100.5' }), false, 'forged CF entry is not right-most');
assert.equal(T({ remoteAddress: '172.18.0.4', xForwardedFor: '198.51.100.5' }), false);
assert.equal(T({ remoteAddress: '172.18.0.4', xForwardedFor: undefined }), false);
assert.equal(T({ remoteAddress: '198.51.100.5', xForwardedFor: '173.245.48.9' }), false, 'public non-CF peer cannot vouch via XFF');
assert.equal(T({ remoteAddress: '198.51.100.5' }), false);
assert.equal(T({ remoteAddress: undefined }), false);
// trust proxy off (dev): XFF is not believed even from a private peer.
assert.equal(T({ remoteAddress: '127.0.0.1', xForwardedFor: '173.245.48.9', trustProxy: false }), false);
// Operator override.
assert.equal(T({ remoteAddress: '198.51.100.5', envFlag: 'true' }), true);
assert.equal(T({ remoteAddress: '198.51.100.5', envFlag: ' TRUE ' }), true);
assert.equal(T({ remoteAddress: '198.51.100.5', envFlag: 'false' }), false);
assert.equal(T({ remoteAddress: '198.51.100.5', envFlag: '1' }), false);

// ── applyCloudflareIp on a request-shaped object ──
const mkReq = (peer: string, headers: Record<string, string>, trustProxy = true): any => ({
  ip: peer, headers, socket: { remoteAddress: peer }, app: { get: (k: string) => (k === 'trust proxy' ? trustProxy : undefined) },
});
delete process.env.TRUST_CF_HEADER;
const origWarn = console.warn; let warns = 0; console.warn = () => { warns += 1; };

let r = mkReq('172.18.0.4', { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7, 173.245.48.9' });
assert.equal(applyCloudflareIp(r), true); assert.equal(r.ip, '203.0.113.7');

r = mkReq('172.18.0.4', { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '198.51.100.5' });
assert.equal(applyCloudflareIp(r), false); assert.equal(r.ip, '172.18.0.4', 'direct hit: header ignored, proxy-derived ip kept');

r = mkReq('172.18.0.4', { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '198.51.100.5' });
applyCloudflareIp(r); assert.equal(warns, 1, 'warns only once per process');

r = mkReq('172.18.0.4', { 'x-forwarded-for': '173.245.48.9' });
assert.equal(applyCloudflareIp(r), false, 'no header -> nothing to restore');

r = mkReq('172.18.0.4', { 'cf-connecting-ip': '<script>', 'x-forwarded-for': '173.245.48.9' });
assert.equal(applyCloudflareIp(r), false, 'malformed header value is never used as an IP');

process.env.TRUST_CF_HEADER = 'true';
r = mkReq('198.51.100.5', { 'cf-connecting-ip': '203.0.113.9' });
assert.equal(applyCloudflareIp(r), true); assert.equal(r.ip, '203.0.113.9');
delete process.env.TRUST_CF_HEADER;
console.warn = origWarn;

console.log('test-client-ip: OK');
