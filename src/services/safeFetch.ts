// Fetching a customer's website from our server (AI-readiness check).
//
// The URL comes from Google Places, i.e. from whoever edited the business profile, so it is
// untrusted. This helper makes the request safe against SSRF:
//   • only http(s) on the default ports, no credentials in the URL;
//   • every address the host resolves to must be public, and the check happens in the socket's
//     own DNS lookup (not in a separate pre-check), so DNS rebinding cannot swap the address;
//   • redirects are followed by hand (max 3) and each hop is validated again;
//   • short timeout, hard body cap, no decompression (identity encoding), nothing is stored.

import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

const blocked = new net.BlockList();
for (const [net4, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as Array<[string, number]>) blocked.addSubnet(net4, bits, 'ipv4');
for (const [net6, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as Array<[string, number]>) blocked.addSubnet(net6, bits, 'ipv6');

/** true only for a routable public unicast address. */
export function isPublicAddress(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is never a legitimate DNS answer, and BlockList would
  // fold it into IPv4 rules, so refuse the whole form.
  if (net.isIPv6(ip) && /^(0{0,4}:){0,5}ffff:/i.test(ip)) return false;
  const family = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null;
  if (!family) return false;
  return !blocked.check(ip, family);
}

export interface SafeResponse { status: number; text: string; finalUrl: string; contentType: string }

export interface SafeGetOptions { timeoutMs?: number; maxBytes?: number; maxRedirects?: number }

/** Parses and validates a URL we are willing to request. Returns null when it is not acceptable. */
export function acceptableUrl(raw: string, isAllowed: (ip: string) => boolean = isPublicAddress, extraPorts: string[] = []): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443' && !extraPorts.includes(u.port)) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (net.isIP(host) && !isAllowed(host)) return null;
  return u;
}

/**
 * Builds a getter. `isAllowed` exists so tests can talk to a local server; production code uses
 * the default instance below, which only ever connects to public addresses.
 */
export function createSafeGet(isAllowed: (ip: string) => boolean = isPublicAddress, extraPorts: string[] = []) {
  const guardedLookup = ((hostname: string, options: dns.LookupOptions, cb: (...a: unknown[]) => void) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) { cb(err); return; }
      const list = addrs as dns.LookupAddress[];
      // One bad answer is enough to refuse: a mixed answer is a rebinding signature.
      if (!list.length || list.some(a => !isAllowed(a.address))) {
        const e = new Error('blocked address') as NodeJS.ErrnoException;
        e.code = 'EBLOCKED';
        cb(e);
        return;
      }
      if (options.all) cb(null, list);
      else cb(null, list[0].address, list[0].family);
    });
  }) as unknown as typeof dns.lookup;

  return function safeGetText(rawUrl: string, opts: SafeGetOptions = {}): Promise<SafeResponse | null> {
    const timeoutMs = opts.timeoutMs ?? 4000;
    const maxBytes = opts.maxBytes ?? 400_000;
    const maxRedirects = opts.maxRedirects ?? 3;

    const hop = (url: string, left: number): Promise<SafeResponse | null> => new Promise(resolve => {
      const u = acceptableUrl(url, isAllowed, extraPorts);
      if (!u) { resolve(null); return; }
      const mod = u.protocol === 'https:' ? https : http;
      let done = false;
      const finish = (v: SafeResponse | null) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      const req = mod.request(u, {
        method: 'GET',
        lookup: guardedLookup,
        headers: {
          'User-Agent': 'PageyAuditBot/1.0 (+https://pagey.co.il/audit)',
          Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
          'Accept-Encoding': 'identity',
        },
      }, res => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (left <= 0) { finish(null); return; }
          let next: string;
          try { next = new URL(res.headers.location, u).toString(); } catch { finish(null); return; }
          clearTimeout(timer);
          done = true;
          hop(next, left - 1).then(resolve);
          return;
        }
        const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
        if (contentType && !/^(text\/|application\/(xhtml|xml))/.test(contentType)) { res.resume(); finish({ status, text: '', finalUrl: u.toString(), contentType }); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          chunks.push(c);
          if (size >= maxBytes) { req.destroy(); finish({ status, text: Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8'), finalUrl: u.toString(), contentType }); }
        });
        res.on('end', () => finish({ status, text: Buffer.concat(chunks).toString('utf8'), finalUrl: u.toString(), contentType }));
        res.on('error', () => finish(null));
      });
      const timer = setTimeout(() => { req.destroy(); finish(null); }, timeoutMs);
      req.on('error', () => finish(null));
      req.end();
    });

    return hop(rawUrl, maxRedirects);
  };
}

export const safeGetText = createSafeGet();
