// The preview's reviews area: the calls the reviews cards make, answered from memory. Same shapes as
// the server's answers; nothing leaves the browser. `&sample=approved` has one reply waiting,
// `&sample=quiet` has none.
import { sampleVariant } from './sample';

interface Item { id: string; first_name: string; phone: string; status: 'new' | 'sent' | 'reviewed'; next: 'send' | 'wait' | 'followup' | 'done'; waitDays: number }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function sampleReviewsFetcher(): (input: string, init?: RequestInit) => Promise<Response> {
  let drafts = sampleVariant() === 'approved' ? [{
    id: 'sample-draft', rating: 2, reviewer: 'יוסי מ׳', createdAt: new Date(Date.now() - 62 * 3_600_000).toISOString(),
    reviewText: 'הגיע באיחור של שעה, ולא עדכנו אותי מראש. העבודה עצמה הייתה בסדר.',
    draft: 'יוסי, תודה שכתבת לנו. צר לנו על האיחור ועל כך שלא עדכנו מראש. נשמח לשמוע ממך בטלפון 052-555-0142 כדי להבין מה קרה.',
  }] : [];
  let items: Item[] = [
    { id: 'sample-r1', first_name: 'מיכל', phone: '972525550187', status: 'sent', next: 'wait', waitDays: 4 },
    { id: 'sample-r0', first_name: 'דוד', phone: '972545550121', status: 'new', next: 'send', waitDays: 0 },
  ];
  let services = ['תיקון נזילות', 'פתיחת סתימות', 'החלפת דוד שמש'];
  const body = (init?: RequestInit): Record<string, unknown> => {
    try { return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>; } catch { return {}; }
  };

  return async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = input.split('?')[0];
    if (path === '/api/seo/review-drafts') return json({ drafts, canPublish: false });
    const draft = /^\/api\/seo\/review-drafts\/([^/]+)\/(publish|dismiss)$/.exec(path);
    if (draft) { drafts = drafts.filter((d) => d.id !== draft[1]); return json({ ok: true }); }
    if (path === '/api/seo/businesses') return json({ businesses: [{ id: 'sample-business', name: 'אינסטלציה אבי כהן', google_place_id: 'sample-place' }] });
    if (path.endsWith('/services')) {
      if (method === 'PUT') { const list = body(init).services; if (Array.isArray(list)) services = list.map(String).slice(0, 8); }
      return json({ services });
    }
    if (path === '/api/seo/review-requests') {
      if (method === 'POST') {
        const b = body(init);
        const digits = String(b.phone ?? '').replace(/\D/g, '');
        if (!/^0?5\d{8}$/.test(digits)) return json({ error: 'מספר הנייד לא תקין.' }, 400);
        items = [{ id: `sample-r${items.length + 1}`, first_name: String(b.name ?? '').trim(), phone: `972${digits.replace(/^0/, '')}`, status: 'new', next: 'send', waitDays: 0 }, ...items];
      }
      return json({ items });
    }
    const one = /^\/api\/seo\/review-requests\/([^/]+)(?:\/(sent|reviewed))?$/.exec(path);
    if (one) {
      if (method === 'DELETE') items = items.filter((i) => i.id !== one[1]);
      else items = items.map((i) => (i.id !== one[1] ? i : one[2] === 'reviewed'
        ? { ...i, status: 'reviewed', next: 'done' }
        : i.next === 'followup' ? { ...i, next: 'done' } : { ...i, status: 'sent', next: 'wait', waitDays: 7 }));
      return json({ ok: true });
    }
    return json({ error: 'בתצוגה לדוגמה הפעולה הזאת לא זמינה.' }, 404);
  };
}
