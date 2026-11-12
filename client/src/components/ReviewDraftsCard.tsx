import { useEffect, useState } from 'react';
import { Check, Star } from 'lucide-react';
import { authFetch } from '../lib/api';

// Reviews that waited 5+ days for an answer, each with a draft reply. While Google's API access is
// not approved (the server says `canPublish: false`) the card is copy-and-paste only and never
// promises publishing. When the server reports that publishing works, nothing is sent unless the
// owner presses the publish button on that card; the text sent is exactly what is in the box.

export interface Draft { id: string; rating: number; reviewer: string | null; createdAt: string; draft: string; reviewText: string | null }
type Fetcher = typeof authFetch;

interface Props {
  onChange?: () => void;
  /** the preview passes its in-memory sample instead of the server */
  fetcher?: Fetcher;
  /** the automatic product's reviews area: its own heading, and a calm line instead of hiding when nothing waits */
  title?: string;
  emptyText?: string;
}

function Row({ d, canPublish, onDone, fetcher }: { d: Draft; canPublish: boolean; onDone: (id: string, msg: string) => void; fetcher: Fetcher }) {
  const [text, setText] = useState(d.draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  async function act(path: 'publish' | 'dismiss') {
    setBusy(true); setErr('');
    try {
      const r = await fetcher(`/api/seo/review-drafts/${encodeURIComponent(d.id)}/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(path === 'publish' ? { text } : {}),
      });
      const body = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) { setErr(body.error ?? 'משהו השתבש. נסו שוב.'); return; }
      onDone(d.id, path === 'publish' ? 'התשובה פורסמה בגוגל.' : '');
    } catch { setErr('משהו השתבש. נסו שוב.'); } finally { setBusy(false); }
  }

  return (
    <li className="rounded-lg border border-slate-200 p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-slate-800">{d.reviewer ?? 'לקוח/ה'}</span>
        <span className="flex items-center gap-0.5 text-amber-500" aria-label={`${d.rating} כוכבים`}>
          {Array.from({ length: d.rating }, (_, i) => <Star key={i} size={14} fill="currentColor" />)}
        </span>
      </div>
      {d.reviewText && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{d.reviewText}</p>}
      <label className="text-xs text-slate-500">טיוטת תשובה (אפשר לערוך)
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={4000}
          className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
      </label>
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      {!canPublish && <p className="text-xs text-slate-500">אחרי ההעתקה, הדביקו את התשובה כתגובה לביקורת בכרטיס העסק שלכם בגוגל.</p>}
      {copied && <p role="status" className="sr-only">התשובה הועתקה</p>}
      <div className="flex flex-wrap gap-2">
        {canPublish && (
          <button type="button" disabled={busy || text.trim().length < 2} onClick={() => void act('publish')}
            className="min-h-[40px] rounded-lg bg-[#2E63F6] px-4 text-sm font-medium text-white disabled:opacity-50">פרסום התשובה בגוגל</button>
        )}
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined); }}
          className={canPublish
            ? 'min-h-[40px] rounded-lg border border-slate-200 px-4 text-sm text-slate-700'
            : 'min-h-[40px] rounded-lg bg-[#2E63F6] px-4 text-sm font-medium text-white'}>{copied ? 'הועתק' : 'העתקת התשובה'}</button>
        <button type="button" disabled={busy} onClick={() => void act('dismiss')}
          className="min-h-[40px] rounded-lg px-3 text-sm text-slate-500 hover:text-slate-800 disabled:opacity-50">דילוג</button>
      </div>
    </li>
  );
}

export default function ReviewDraftsCard({ onChange, fetcher = authFetch, title, emptyText }: Props = {}) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [note, setNote] = useState('');
  const [canPublish, setCanPublish] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetcher('/api/seo/review-drafts').then((r) => { if (!r.ok) throw new Error('load'); return r.json(); })
      .then((b: { drafts?: Draft[]; canPublish?: boolean }) => { if (!live) return; setFailed(false); setCanPublish(b.canPublish === true); setDrafts(b.drafts ?? []); })
      .catch(() => { if (live) { setFailed(true); setDrafts([]); } });
    return () => { live = false; };
  }, [fetcher, tick]);
  const always = emptyText !== undefined;
  if (!always && (!drafts || (drafts.length === 0 && !note))) return null;
  const list = drafts ?? [];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title ?? 'ביקורות שמחכות לתשובה'}</h3>
        {(!always || list.length > 0) && (
          <p className="mt-1 text-sm text-slate-500">
            {canPublish
              ? 'הכנו טיוטה לכל ביקורת שלא נענתה כמה ימים. התשובה נשלחת לגוגל רק כשאתם לוחצים על "פרסום", בדיוק בנוסח שבתיבה.'
              : 'הכנו טיוטה לכל ביקורת שלא נענתה כמה ימים. אפשר לערוך אותה, להעתיק ולהדביק בכרטיס העסק שלכם בגוגל.'}
          </p>
        )}
      </div>
      {note && <p role="status" className="text-sm text-emerald-700">{note}</p>}
      {always && drafts === null && <p role="status" className="text-sm text-slate-500">טוען…</p>}
      {always && drafts !== null && failed && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-700">
          <span>לא הצלחנו לטעון את התשובות שמחכות.</span>
          <button type="button" onClick={() => { setDrafts(null); setTick((n) => n + 1); }}
            className="min-h-[44px] rounded-lg border border-slate-200 px-4 text-sm text-slate-700">ניסיון חוזר</button>
        </div>
      )}
      {always && drafts !== null && !failed && list.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-slate-600">
          <span aria-hidden className="inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check size={14} strokeWidth={3} /></span>
          {emptyText}
        </p>
      )}
      {list.length > 0 && (
        <ul className="flex flex-col gap-3">
          {list.map((d) => <Row key={d.id} d={d} canPublish={canPublish} fetcher={fetcher} onDone={(id, msg) => { setDrafts((cur) => (cur ?? []).filter((x) => x.id !== id)); if (msg) setNote(msg); onChange?.(); }} />)}
        </ul>
      )}
    </div>
  );
}
