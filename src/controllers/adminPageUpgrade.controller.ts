// Admin: bring an existing page up to the latest features (decision 22.11). Behind the admin gate.
//   POST /api/admin/pages/:id/category        detect the category from the page's own text and set it (auto),
//                                              unless the owner already chose one by hand
//   POST /api/admin/pages/:id/translations    add a language (same as the owner's "הוספת שפה")
import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { detectCategory, isMissingCategoryColumn } from '../services/pageCategory';
import { serverError } from '../utils/httpErrors';

interface Row { id: string; business_name: string; ai_content: any; category?: string | null; category_source?: string | null }

/** The page's own words, in the order they describe the business best. Pure, exported for tests. */
export function pageTextForDetection(ai: any): string {
  const parts: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && v.trim()) parts.push(v.trim()); };
  push(ai?.hero?.title); push(ai?.hero?.subtitle); push(ai?.about?.heading); push(ai?.about?.text); push(ai?.about?.body);
  for (const s of Array.isArray(ai?.services_or_benefits) ? ai.services_or_benefits : []) { push(s?.title); push(s?.description); }
  return parts.join('\n').slice(0, 4000);
}

export async function adminDetectCategory(req: Request, res: Response): Promise<void> {
  try {
    const { data, error } = await supabase.from('landing_pages').select('*').eq('id', req.params.id).maybeSingle();
    if (error || !data) { res.status(404).json({ error: 'הדף לא נמצא.' }); return; }
    const page = data as unknown as Row;
    if (!('category' in page)) { res.status(503).json({ code: 'not_migrated', error: 'מיגרציה 053 עוד לא רצה.' }); return; }
    if (page.category_source === 'manual') { res.json({ category: page.category, changed: false, reason: 'manual' }); return; }
    const d = detectCategory({ description: pageTextForDetection(page.ai_content), businessName: page.business_name });
    const { error: upErr } = await supabase.from('landing_pages').update({ category: d.id, category_source: 'auto' }).eq('id', page.id);
    if (upErr) {
      if (isMissingCategoryColumn(upErr)) { res.status(503).json({ code: 'not_migrated', error: 'מיגרציה 053 עוד לא רצה.' }); return; }
      throw upErr;
    }
    res.json({ category: d.id, confidence: d.confidence, changed: d.id !== (page.category ?? 'general') });
  } catch (e) {
    serverError(res, e, '[ADMIN-PAGE]');
  }
}
