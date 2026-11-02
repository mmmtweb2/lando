import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Trash2, Check } from 'lucide-react';
import { authFetch } from '../lib/api';
import { localPhone, requestText, reviewUrl, waLink } from '../lib/reviewRequestMsg';

interface Saved { id: string; name: string; google_place_id: string | null }
interface Item {
  id: string; first_name: string; phone: string; status: 'new' | 'sent' | 'reviewed';
  next: 'send' | 'wait' | 'followup' | 'done'; waitDays: number;
}

function statusText(i: Item): string {
  if (i.status === 'reviewed') return 'כתב/ה ביקורת 🎉';
  if (i.next === 'send') return 'עוד לא נשלח';
  if (i.next === 'wait') return `נשלח. תזכורת אפשרית בעוד ${i.waitDays === 1 ? 'יום' : `${i.waitDays} ימים`}`;
  if (i.next === 'followup') return 'אפשר לשלוח תזכורת אחת';
  return 'נשלחו בקשה ותזכורת';
}

function Business({ b }: { b: Saved }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const link = reviewUrl(b.google_place_id!);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`/api/seo/review-requests?businessId=${encodeURIComponent(b.id)}`);
      if (r.status === 503) { setErr('הכלי הזה עדיין לא הופעל.'); setItems([]); return; }
      const body = await r.json().catch(() => ({}));
      setItems(r.ok ? (body.items ?? []) : []);
    } catch { setItems([]); }
  }, [b.id]);
  useEffect(() => { void load(); }, [load]);

  async function call(path: string, init?: RequestInit): Promise<boolean> {
    setErr('');
    try {
      const r = await authFetch(path, init);
      if (!r.ok) { const body = await r.json().catch(() => ({})) as { error?: string }; setErr(body.error ?? 'משהו השתבש. נסו שוב.'); return false; }
      return true;
    } catch { setErr('משהו השתבש. נסו שוב.'); return false; }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    const ok = await call('/api/seo/review-requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessId: b.id, name, phone }),
    });
    setBusy(false);
    if (ok) { setName(''); setPhone(''); await load(); }
  }

  async function send(i: Item) {
    // Open WhatsApp first (a popup must start from the click), then remember that it was sent.
    window.open(waLink(i.phone, requestText(i.next === 'followup' ? 'followup' : 'first', i.first_name, b.name, link)), '_blank', 'noopener,noreferrer');
    if (await call(`/api/seo/review-requests/${i.id}/sent`, { method: 'POST' })) await load();
  }

  return (
    <div className="rounded-lg border border-slate-200 p-4 flex flex-col gap-3">
      <div className="font-semibold text-slate-900">{b.name}</div>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">שם פרטי
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required
            className="mt-1 block w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
        </label>
        <label className="text-xs text-slate-500">נייד
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" required placeholder="050-1234567"
            className="mt-1 block w-40 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
        </label>
        <button type="submit" disabled={busy || !name.trim() || !phone.trim()}
          className="min-h-[40px] rounded-lg bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50">הוספה</button>
      </form>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {items && items.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800">{i.first_name} <span className="text-xs font-normal text-slate-400" dir="ltr">{localPhone(i.phone)}</span></div>
                <div className="text-xs text-slate-500">{statusText(i)}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {(i.next === 'send' || i.next === 'followup') && (
                  <button type="button" onClick={() => send(i)}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <MessageCircle size={14} /> {i.next === 'followup' ? 'תזכורת בוואטסאפ' : 'שליחה בוואטסאפ'}
                  </button>
                )}
                {i.status !== 'reviewed' && i.status === 'sent' && (
                  <button type="button" onClick={async () => { if (await call(`/api/seo/review-requests/${i.id}/reviewed`, { method: 'POST' })) await load(); }}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 hover:bg-slate-50"><Check size={14} /> כתב/ה ביקורת</button>
                )}
                <button type="button" aria-label={`מחיקת ${i.first_name}`} onClick={async () => { if (await call(`/api/seo/review-requests/${i.id}`, { method: 'DELETE' })) await load(); }}
                  className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Stage 7: the owner's list of customers to ask for a Google review. The message leaves from the owner's own WhatsApp. */
export default function ReviewRequestsCard() {
  const [list, setList] = useState<Saved[] | null>(null);
  useEffect(() => {
    authFetch('/api/seo/businesses').then((r) => (r.ok ? r.json() : { businesses: [] }))
      .then((b: { businesses?: Saved[] }) => setList((b.businesses ?? []).filter((x) => !!x.google_place_id)))
      .catch(() => setList([]));
  }, []);
  if (!list || list.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">בקשות ביקורת מלקוחות</h3>
        <p className="mt-1 text-sm text-slate-500">
          מוסיפים לקוח מרוצה ולוחצים "שליחה בוואטסאפ". ההודעה נפתחת אצלכם מוכנה, ויוצאת מהוואטסאפ שלכם, לא מאיתנו.
          כדי לא להציק: בקשה אחת ותזכורת אחת בלבד, בהפרש של שבוע. שלחו רק ללקוחות שהיו אצלכם בפועל.
        </p>
      </div>
      {list.map((b) => <Business key={b.id} b={b} />)}
    </div>
  );
}
