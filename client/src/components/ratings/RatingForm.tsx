import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { StarsInput } from './Stars';
import { CONSENT_LABEL, PRODUCT_LABEL, saveRating, type MyRating, type RatingProduct } from './ratingsApi';

/** The rating dialog. Saves as "pending": nothing is shown publicly before review and consent. */
export default function RatingForm({ product, initial, onClose, onSaved }: {
  product: RatingProduct; initial: MyRating | null; onClose: () => void; onSaved: () => void;
}) {
  const [stars, setStars] = useState(initial?.stars ?? 0);
  const [text, setText] = useState(initial?.text ?? '');
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [businessType, setBusinessType] = useState(initial?.businessType ?? '');
  const [consent, setConsent] = useState(initial?.consentPublish ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const first = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!stars) { setError('בחרו כמה כוכבים.'); return; }
    if (consent && !displayName.trim()) { setError('כדי שנציג את הדירוג באתר, כתבו איך להציג את השם.'); return; }
    setBusy(true); setError(null);
    const r = await saveRating(product, { stars, text, displayName, businessType, consentPublish: consent });
    setBusy(false);
    if (!r.ok) { setError(r.error ?? 'לא הצלחנו לשמור.'); return; }
    setDone(true); onSaved();
  };

  const input = 'mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="rating-title" onClick={onClose}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="rating-title" ref={first} tabIndex={-1} className="text-lg font-black text-slate-900 focus:outline-none">
            {done ? 'תודה רבה!' : `איך היה עם ${PRODUCT_LABEL[product]}?`}
          </h2>
          <button type="button" onClick={onClose} aria-label="סגירה" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"><X size={20} aria-hidden /></button>
        </div>

        {done ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              {consent ? 'הדירוג נשמר. אחרי בדיקה קצרה הוא יופיע באתר, בדיוק במילים שכתבתם.' : 'הדירוג נשמר אצלנו. הוא לא יוצג באתר, כי לא סימנתם הסכמה.'}
            </p>
            <button type="button" onClick={onClose} className="mt-5 w-full rounded-full bg-[#2E63F6] px-5 py-3 font-bold text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300">סגירה</button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">כמה מילים כנות עוזרות לבעלי עסקים אחרים להחליט, ועוזרות לנו להשתפר.</p>
            <div className="mt-4"><StarsInput value={stars} onChange={setStars} /></div>

            <label className="mt-4 block text-sm font-medium text-slate-700">
              מה תרצו לספר? <span className="font-normal text-slate-400">(לא חובה)</span>
              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 400))} rows={4} className={input} maxLength={400} />
              <span className="mt-1 block text-xs text-slate-400">{text.length}/400 · בלי קישורים ובלי מספרי טלפון</span>
            </label>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                איך להציג את השם
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value.slice(0, 40))} maxLength={40} placeholder="למשל: דנה ל." className={input} />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                סוג העסק
                <input value={businessType} onChange={(e) => setBusinessType(e.target.value.slice(0, 40))} maxLength={40} placeholder="למשל: מספרה ברמת גן" className={input} />
              </label>
            </div>

            <label className="mt-4 flex items-start gap-2.5 text-sm text-slate-700">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#2E63F6]" />
              <span>{CONSENT_LABEL}</span>
            </label>
            <p className="mt-1 ps-7 text-xs text-slate-400">אנחנו לא עורכים את הדירוג. אם תשנו אותו בהמשך, הוא יחזור לבדיקה.</p>

            {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
              <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 sm:flex-1">ביטול</button>
              <button type="button" onClick={submit} disabled={busy} className="rounded-full bg-[#2E63F6] px-5 py-3 font-bold text-white disabled:opacity-60 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 sm:flex-1">
                {busy ? 'שומרים…' : 'שליחת הדירוג'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
