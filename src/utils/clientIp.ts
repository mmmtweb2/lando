// Real-visitor IP behind Cloudflare — and WHEN the CF-Connecting-IP header may be believed.
//
// Customer subdomains (cafe-dani.pagey.co.il) are proxied by Cloudflare, so the address Express
// sees is Cloudflare's, and the visitor's address is only in the CF-Connecting-IP header. That
// header is a plain request header: any client that reaches the origin WITHOUT going through
// Cloudflare (a direct hit on the origin IP / the Traefik port, or any non-proxied hostname that
// still passes the host check) can put anything in it and thereby choose its own "IP" — which
// defeats every per-IP rate limiter and daily cap. So the header is honoured only when the
// request provably came from Cloudflare.
//
// "Provably" means ONE of:
//   1. TRUST_CF_HEADER=true in the environment (operator override — e.g. when the proxy chain is
//      unusual, or Cloudflare adds a range before CLOUDFLARE_IPV4/IPV6 below is updated).
//   2. The TCP peer itself is in Cloudflare's published ranges (origin exposed directly to CF).
//   3. The TCP peer is a private/loopback address (our own reverse proxy: Traefik in Coolify) AND
//      Express is configured with `trust proxy` AND the RIGHT-MOST X-Forwarded-For entry — the
//      one our own proxy appended, i.e. the address that actually connected to it — is in
//      Cloudflare's ranges. The right-most entry cannot be forged by the client: the proxy writes
//      it. A client that bypasses Cloudflare and talks to Traefik directly shows up there with
//      its own address, which is not Cloudflare's, so the header is ignored.
// Otherwise the normal Express `req.ip` (trust-proxy semantics) is used.

import net from 'net';
import type { NextFunction, Request, Response } from 'express';

/**
 * Cloudflare's published edge ranges. Source of truth: https://www.cloudflare.com/ips-v4 and
 * https://www.cloudflare.com/ips-v6 (also https://api.cloudflare.com/client/v4/ips).
 * Cloudflare changes these rarely (a new range was last added in 2024). If they change and this
 * list is stale, visitors from the new range fall back to the proxy address (coarser per-IP
 * limits, never a security hole); set TRUST_CF_HEADER=true or update this list.
 */
export const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
] as const;

export const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
] as const;

/** Addresses of OUR OWN reverse proxy hop (Traefik/Docker network, loopback). */
const PRIVATE_V4 = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10'] as const;
const PRIVATE_V6 = ['::1/128', 'fc00::/7', 'fe80::/10'] as const;

function buildList(v4: readonly string[], v6: readonly string[]): net.BlockList {
  const list = new net.BlockList();
  for (const c of v4) { const [a, p] = c.split('/'); list.addSubnet(a, Number(p), 'ipv4'); }
  for (const c of v6) { const [a, p] = c.split('/'); list.addSubnet(a, Number(p), 'ipv6'); }
  return list;
}

const cloudflareList = buildList(CLOUDFLARE_IPV4, CLOUDFLARE_IPV6);
const privateList = buildList(PRIVATE_V4, PRIVATE_V6);

/** Strips brackets / zone / an IPv4-mapped prefix; returns null for anything that is not an IP. */
export function normalizeIp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith('[') && s.includes(']')) s = s.slice(1, s.indexOf(']'));
  const pct = s.indexOf('%');
  if (pct !== -1) s = s.slice(0, pct);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s);
  if (mapped) s = mapped[1];
  return net.isIP(s) ? s : null;
}

function inList(list: net.BlockList, ip: string | null): boolean {
  if (!ip) return false;
  return list.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

export const isCloudflareIp = (ip: unknown): boolean => inList(cloudflareList, normalizeIp(ip));
export const isPrivateIp = (ip: unknown): boolean => inList(privateList, normalizeIp(ip));

/** The right-most X-Forwarded-For entry (the hop our own proxy appended), or null. */
export function lastForwardedFor(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length ? normalizeIp(parts[parts.length - 1]) : null;
}

export interface TrustInput {
  /** req.socket.remoteAddress */
  remoteAddress: string | undefined;
  /** raw X-Forwarded-For header */
  xForwardedFor: string | string[] | undefined;
  /** true when Express has `trust proxy` enabled (production) */
  trustProxy: boolean;
  /** process.env.TRUST_CF_HEADER */
  envFlag?: string | undefined;
}

/** True when a CF-Connecting-IP header on this request may be believed. See the header comment. */
export function shouldTrustCfHeader(i: TrustInput): boolean {
  if ((i.envFlag ?? '').trim().toLowerCase() === 'true') return true;
  const peer = normalizeIp(i.remoteAddress);
  if (!peer) return false;
  if (isCloudflareIp(peer)) return true;
  if (i.trustProxy && isPrivateIp(peer) && isCloudflareIp(lastForwardedFor(i.xForwardedFor))) return true;
  return false;
}

/** The visitor IP carried by CF-Connecting-IP, or null when absent/malformed. */
export function cfConnectingIp(header: string | string[] | undefined): string | null {
  return normalizeIp(Array.isArray(header) ? header[0] : header);
}

let warnedUntrusted = false;

/**
 * Express middleware: on a request whose CF-Connecting-IP is trustworthy, makes `req.ip` the real
 * visitor address (so every rate limiter downstream keys on it). Otherwise leaves `req.ip` alone.
 * Scope (which hosts) is decided by the caller.
 */
export function applyCloudflareIp(req: Request): boolean {
  const claimed = cfConnectingIp(req.headers['cf-connecting-ip']);
  if (!claimed) return false;
  const trusted = shouldTrustCfHeader({
    remoteAddress: req.socket?.remoteAddress,
    xForwardedFor: req.headers['x-forwarded-for'],
    trustProxy: Boolean(req.app?.get('trust proxy')),
    envFlag: process.env.TRUST_CF_HEADER,
  });
  if (!trusted) {
    if (!warnedUntrusted) {
      warnedUntrusted = true;
      console.warn('[ip] ignoring CF-Connecting-IP: the request did not arrive from Cloudflare\'s IP ranges (peer/X-Forwarded-For). ' +
        'If this is unexpected behind Cloudflare, set TRUST_CF_HEADER=true. (logged once)');
    }
    return false;
  }
  Object.defineProperty(req, 'ip', { value: claimed, configurable: true });
  return true;
}

export function cloudflareIpMiddleware(req: Request, _res: Response, next: NextFunction): void {
  applyCloudflareIp(req);
  next();
}
