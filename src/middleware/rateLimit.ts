import { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal in-memory rate limiter — no external dependency.
 *
 * Good enough for a single-instance beta: it caps how many times a given client
 * (by IP) can hit an endpoint inside a rolling window. When you scale to more than
 * one server instance, swap the in-memory Map for a shared store (e.g. Redis),
 * because each instance keeps its own counters.
 *
 * NOTE: behind a proxy/load-balancer, set `app.set('trust proxy', 1)` so `req.ip`
 * reflects the real client and not the proxy.
 */
export function rateLimit(opts: { windowMs: number; max: number; message?: string }) {
  const { windowMs, max } = opts;
  const message = opts.message ?? 'יותר מדי בקשות. נסו שוב מאוחר יותר.';
  const hits = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    // Opportunistic cleanup so the Map can't grow without bound.
    if (hits.size > 5000) {
      for (const [key, b] of hits) {
        if (now > b.resetAt) hits.delete(key);
      }
    }

    const bucket = hits.get(ip);
    if (!bucket || now > bucket.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: message });
      return;
    }
    next();
  };
}
