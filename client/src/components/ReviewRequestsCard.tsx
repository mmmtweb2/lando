import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Trash2, Check } from 'lucide-react';
import { authFetch } from '../lib/api';
import { localPhone, requestText, reviewUrl, waLink } from '../lib/reviewRequestMsg';

interface Saved { id: string; name: string; google_place_id: string | null }
type Fetcher = typeof authFetch;
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

function Business({ b, onSent, fetcher, plain }: { b: Saved; onSent?: () => void; fetcher: Fetcher; plain: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [choosing, setChoosing] = useState<string | null>(null);
  const link = reviewUrl(b.google_place_id!);

  const load = useCallback(async () => {
    try {
      const r = await fetcher(`/api/seo/review-requests?businessId=${encodeURIComponent(b.id)}`);
      if (r.status === 503) { setErr('הכלי הזה עדיין לא הופעל.'); setItems([]); return; }
      const body = await r.json().catch(() => ({}));
      setItems(r.ok ? (body.items ?? []) : []);
    } catch { setItems([]); }
  }, [b.id, fetcher]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    fetcher(`/api/seo/businesses/${encodeURIComponent(b.id)}/services`)
      .then((r) => (r.ok ? r.json() : { services: [] }))
      .then((x: { services?: string[] }) => setServices(x.services ?? []))
      .catch(() => setServices([]));
  }, [b.id, fetcher]);

  async function saveServices() {
    const list = draft.split(/[\n,،]/).map((x) => x.trim()).filter(Boolean);
    setErr('');
    try {
      const r = await fetcher(`/api/seo/businesses/${encodeURIComponent(b.id)}/services`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ services: list }),
      });
      const body = await r.json().catch(() => ({})) as { services?: string[]; error?: string };
      if (!r.ok) { setErr(body.error ?? 'משהו השתבש. נסו שוב.'); return; }
      setServices(body.services ?? []); setEditing(false);
    } catch { setErr('משהו השתבש. נסו שוב.'); }
  }

  async function call(path: string, init?: RequestInit): Promise<boolean> {
    setErr('');
    try {
      const r = await fetcher(path, init);
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

  async function send(i: Item, service: string | null) {
    // Open WhatsApp first (a popup must start from the click), then remember that it was sent.
    setChoosing(null);
    window.open(waLink(i.phone, requestText(i.next === 'followup' ? 'followup' : 'first', i.first_name, b.name, link, service)), '_blank', 'noopener,noreferrer');
    if (await call(`/api/seo/review-requests/${i.id}/sent`, { method: 'POST' })) { onSent?.(); await load(); }
  }

  return (
    <div className={plain ? 'flex flex-col gap-3' : 'rounded-lg border border-slate-200 p-4 flex flex-col gap-3'}>
      {!plain && <div className="font-semibold text-slate-900">{b.name}</div>}
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
      <div className="text-xs text-slate-500">
        {!editing ? (
          <p>
            {services.length > 0 ? <>השירותים שלכם: {services.join(' · ')}. </> : 'אפשר להוסיף את רשימת השירותים שלכם, והודעת הבקשה תציין איזה שירות הלקוח קיבל. '}
            <button type="button" onClick={() => { setDraft(services.join(', ')); setEditing(true); }} className="underline hover:text-slate-700">
              {services.length > 0 ? 'עריכה' : 'הוספת שירותים'}
            </button>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="block">עד 8 שירותים, מופרדים בפסיק
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={400} placeholder="ניקיון דירות, צביעה, תיקוני אינסטלציה"
                className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={saveServices} className="min-h-[36px] rounded-lg bg-slate-900 px-4 text-xs font-medium text-white">שמירה</button>
              <button type="button" onClick={() => setEditing(false)} className="min-h-[36px] rounded-lg border border-slate-200 px-4 text-xs text-slate-600">ביטול</button>
            </div>
          </div>
        )}
      </div>
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
                  <button type="button" onClick={() => (services.length > 0 ? setChoosing(choosing === i.id ? null : i.id) : void send(i, null))}
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
              {choosing === i.id && (
                <div className="basis-full rounded-lg bg-slate-50 p-2.5">
                  <p className="mb-1.5 text-xs text-slate-500">איזה שירות {i.first_name} קיבל/ה? ההודעה תציין אותו, והלקוח כותב את הביקורת בעצמו.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {services.map((sv) => (
                      <button key={sv} type="button" onClick={() => void send(i, sv)}
                        className="min-h-[36px] rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-700 hover:bg-slate-100">{sv}</button>
                    ))}
                    <button type="button" onClick={() => void send(i, null)}
                      className="min-h-[36px] rounded-full border border-dashed border-slate-300 px-3 text-xs text-slate-500 hover:bg-slate-100">בלי לציין שירות</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Stage 7: the owner's list of customers to ask for a Google review. The message leaves from the owner's own WhatsApp.
 * `embedded`: the same list as the second part of the automatic product's review kit (ReviewKit.tsx):
 * no card of its own, and the heading comes from there.
 */
export default function ReviewRequestsCard({ onSent, fetcher = authFetch, embedded }: { onSent?: () => void; fetcher?: Fetcher; embedded?: { title: string; lead: string } } = {}) {
  const [list, setList] = useState<Saved[] | null>(null);
  useEffect(() => {
    fetcher('/api/seo/businesses').then((r) => (r.ok ? r.json() : { businesses: [] }))
      .then((b: { businesses?: Saved[] }) => setList((b.businesses ?? []).filter((x) => !!x.google_place_id)))
      .catch(() => setList([]));
  }, [fetcher]);
  if (!list || list.length === 0) return null;
  if (embedded) {
    return (
      <div className="dv4-kit-requests">
        <h4>{embedded.title}</h4>
        <p className="dv4-quiet">{embedded.lead}</p>
        {list.map((b) => <Business key={b.id} b={b} onSent={onSent} fetcher={fetcher} plain={list.length === 1} />)}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">בקשות ביקורת מלקוחות</h3>
        <p className="mt-1 text-sm text-slate-500">
          מוסיפים לקוח מרוצה ולוחצים "שליחה בוואטסאפ". ההודעה נפתחת אצלכם מוכנה, ויוצאת מהוואטסאפ שלכם, לא מאיתנו.
          כדי לא להציק: בקשה אחת ותזכורת אחת בלבד, בהפרש של שבוע. שלחו רק ללקוחות שהיו אצלכם בפועל.
        </p>
      </div>
      {list.map((b) => <Business key={b.id} b={b} onSent={onSent} fetcher={fetcher} plain={false} />)}
    </div>
  );
}
