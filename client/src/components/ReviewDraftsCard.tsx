import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { authFetch } from '../lib/api';

// Reviews that waited 5+ days for an answer, each with a draft reply. While Google's API access is
// not approved (the server says `canPublish: false`) the card is copy-and-paste only and never
// promises publishing. When the server reports that publishing works, nothing is sent unless the
// owner presses the publish button on that card; the text sent is exactly what is in the box.

interface Draft { id: string; rating: number; reviewer: string | null; createdAt: string; draft: string; reviewText: string | null }

function Row({ d, canPublish, onDone }: { d: Draft; canPublish: boolean; onDone: (id: string, msg: string) => void }) {
  const [text, setText] = useState(d.draft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  async function act(path: 'publish' | 'dismiss') {
    setBusy(true); setErr('');
    try {
      const r = await authFetch(`/api/seo/review-drafts/${encodeURIComponent(d.id)}/${path}`, {
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

export default function ReviewDraftsCard() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [note, setNote] = useState('');
  const [canPublish, setCanPublish] = useState(false);
  useEffect(() => {
    authFetch('/api/seo/review-drafts').then((r) => (r.ok ? r.json() : { drafts: [] }))
      .then((b: { drafts?: Draft[]; canPublish?: boolean }) => { setCanPublish(b.canPublish === true); setDrafts(b.drafts ?? []); })
      .catch(() => setDrafts([]));
  }, []);
  if (!drafts || (drafts.length === 0 && !note)) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">ביקורות שמחכות לתשובה</h3>
        <p className="mt-1 text-sm text-slate-500">
          {canPublish
            ? 'הכנו טיוטה לכל ביקורת שלא נענתה כמה ימים. התשובה נשלחת לגוגל רק כשאתם לוחצים על "פרסום", בדיוק בנוסח שבתיבה.'
            : 'הכנו טיוטה לכל ביקורת שלא נענתה כמה ימים. אפשר לערוך אותה, להעתיק ולהדביק בכרטיס העסק שלכם בגוגל.'}
        </p>
      </div>
      {note && <p role="status" className="text-sm text-emerald-700">{note}</p>}
      <ul className="flex flex-col gap-3">
        {drafts.map((d) => <Row key={d.id} d={d} canPublish={canPublish} onDone={(id, msg) => { setDrafts((cur) => (cur ?? []).filter((x) => x.id !== id)); if (msg) setNote(msg); }} />)}
      </ul>
    </div>
  );
}
