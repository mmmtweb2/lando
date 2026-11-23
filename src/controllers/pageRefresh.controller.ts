// "עדכון הדף לפי פרטי העסק" (README part 146).
//   POST /api/landing/:id/refresh-from-card          owner: writes a candidate, returns the review (nothing saved)
//   POST /api/landing/:id/refresh-from-card/apply    owner: {token, sections} saves only the ticked sections
//   POST /api/admin/pages/:id/refresh-from-card      admin gate: writes and applies every changed section
import { Request, Response } from 'express';
import { serverError } from '../utils/httpErrors';
import { touchDraft } from '../services/draftCleanup.service';
import { RefreshError, adminRefresh, applyRefresh, previewRefresh } from '../services/pageRefresh.service';

function fail(res: Response, e: unknown): void {
  if (e instanceof RefreshError) { res.status(e.status).json({ code: e.code, error: e.message }); return; }
  serverError(res, e, '[PAGE-REFRESH]');
}

export async function postRefreshPreview(req: Request, res: Response): Promise<void> {
  try { res.json(await previewRefresh(req.params.id)); } catch (e) { fail(res, e); }
}

export async function postRefreshApply(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as { token?: unknown; sections?: unknown };
  try {
    const r = await applyRefresh(req.params.id, body.token, body.sections);
    touchDraft(req.params.id);
    res.json(r);
  } catch (e) { fail(res, e); }
}

export async function adminPostRefresh(req: Request, res: Response): Promise<void> {
  try {
    const r = await adminRefresh(req.params.id);
    touchDraft(req.params.id);
    res.json({ applied: r.applied, category: r.category });
  } catch (e) { fail(res, e); }
}
