import { NextFunction, Request, Response } from 'express';

/**
 * Rejects a request whose body is larger than `maxBytes` with 413. The global express.json() parser
 * (100 KB default) has already run by the time a route middleware executes, so this is a tighter,
 * per-route ceiling for public endpoints whose real payloads are tiny: it checks the declared
 * Content-Length first and, for bodies without one (chunked), the size of the parsed JSON.
 */
export function rejectOversizeBody(maxBytes: number, message = 'הבקשה גדולה מדי.') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const declared = Number(req.headers['content-length']);
    let size = Number.isFinite(declared) && declared >= 0 ? declared : 0;
    if (!size && req.body && typeof req.body === 'object') {
      try { size = Buffer.byteLength(JSON.stringify(req.body)); } catch { size = maxBytes + 1; }
    }
    if (size > maxBytes) { res.status(413).json({ error: message }); return; }
    next();
  };
}
