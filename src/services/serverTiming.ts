// Server-side timing of the calls we make to Supabase, per request (task perf/server-latency).
//
// Why: every query crosses the network, so response time is roughly (number of sequential
// round trips) x (latency to Supabase). This makes both numbers visible, and puts a ceiling on
// READ queries so one stuck query can no longer hang a request forever.
//
// - SERVER_TIMING=true : adds a `Server-Timing` header (total, auth, db, storage, with call counts)
//   and logs requests slower than SLOW_REQUEST_MS (default 1500) as `[slow] METHOD route status ...`.
//   Route pattern only: no query string, no body, no email. Off by default.
// - SUPABASE_READ_TIMEOUT_MS (default 15000, 0 = off): applies only to GET requests to PostgREST
//   (`/rest/v1`). Writes, auth and storage are never cut off, so a payment or an upload can not be
//   reported as failed while it actually went through.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request as ExpressRequest, Response, NextFunction } from 'express';

export type Bucket = 'auth' | 'db' | 'storage' | 'other';
interface Stat { n: number; ms: number }
export interface Timing { start: number; stats: Record<Bucket, Stat> }

const store = new AsyncLocalStorage<Timing>();

export function timingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SERVER_TIMING === 'true';
}

export function readTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SUPABASE_READ_TIMEOUT_MS;
  if (raw === undefined || raw === '') return 15000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 15000;
}

export function slowMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SLOW_REQUEST_MS);
  return Number.isFinite(n) && n > 0 ? n : 1500;
}

/** Which kind of Supabase call a URL is. Pure, no side effects. */
export function classify(url: string): Bucket {
  if (url.includes('/auth/v1/')) return 'auth';
  if (url.includes('/rest/v1/')) return 'db';
  if (url.includes('/storage/v1/')) return 'storage';
  return 'other';
}

export function newTiming(now = Date.now()): Timing {
  return { start: now, stats: { auth: { n: 0, ms: 0 }, db: { n: 0, ms: 0 }, storage: { n: 0, ms: 0 }, other: { n: 0, ms: 0 } } };
}

export function record(t: Timing, bucket: Bucket, ms: number): void {
  t.stats[bucket].n += 1;
  t.stats[bucket].ms += ms;
}

/** `total;dur=412.0, auth;dur=300.2;desc="1 calls", db;dur=...;desc="3 calls"` (only buckets that were used). */
export function serverTimingHeader(t: Timing, now = Date.now()): string {
  const parts = [`total;dur=${(now - t.start).toFixed(1)}`];
  for (const b of ['auth', 'db', 'storage', 'other'] as Bucket[]) {
    const s = t.stats[b];
    if (s.n > 0) parts.push(`${b};dur=${s.ms.toFixed(1)};desc="${s.n} calls"`);
  }
  return parts.join(', ');
}

type FetchFn = typeof fetch;

/**
 * Drop-in `fetch` for supabase-js (`global.fetch`). Always cheap: when no request is being timed it
 * only classifies the URL. The read timeout does not depend on SERVER_TIMING.
 */
export function makeTimedFetch(base: FetchFn = fetch, env: NodeJS.ProcessEnv = process.env): FetchFn {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as globalThis.Request).url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? (input as globalThis.Request).method : 'GET')).toUpperCase();
    const bucket = classify(url);
    const limit = bucket === 'db' && method === 'GET' ? readTimeoutMs(env) : 0;
    let nextInit = init;
    if (limit > 0) {
      const timeout = AbortSignal.timeout(limit);
      nextInit = { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout };
    }
    const t = store.getStore();
    const started = t ? Date.now() : 0;
    try {
      return await base(input, nextInit);
    } finally {
      if (t) record(t, bucket, Date.now() - started);
    }
  };
}

/** Express middleware. A no-op unless SERVER_TIMING=true. */
export function serverTimingMiddleware(req: ExpressRequest, res: Response, next: NextFunction): void {
  if (!timingEnabled()) { next(); return; }
  const t = newTiming();
  const writeHead = res.writeHead;
  // Headers must be set before they are sent; hook the moment Express is about to send them.
  res.writeHead = function patched(this: Response, ...args: unknown[]) {
    if (!this.headersSent) this.setHeader('Server-Timing', serverTimingHeader(t));
    return (writeHead as (...a: unknown[]) => Response).apply(this, args);
  } as typeof res.writeHead;
  res.on('finish', () => {
    const total = Date.now() - t.start;
    if (total < slowMs()) return;
    const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : '(static or unmatched)';
    const s = t.stats;
    console.log(`[slow] ${req.method} ${route} ${res.statusCode} total=${total}ms auth=${s.auth.n}/${s.auth.ms}ms db=${s.db.n}/${s.db.ms}ms storage=${s.storage.n}/${s.storage.ms}ms`);
  });
  store.run(t, next);
}
