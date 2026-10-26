import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { getPublicConfig } from '../lib/publicConfig';
import { trackEvent } from '../lib/track';

// Lead capture under a public Audit. The consent box is NEVER pre-ticked, the wording shown is
// the server's own text (so what is stored is what was shown), and without consent nothing is sent.

const FALLBACK_CONSENT = 'אני מאשר/ת שיישלח אליי בוואטסאפ קישור הביקורות ותוכנית החיזוק';

function utm(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const p = new URLSearchParams(window.location.search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
      const v = p.get(k);
      if (v) out[k] = v.slice(0, 80);
    }
  } catch { /* none */ }
  return out;
}

export default function AuditLeadForm({
  placeId, businessName, score,
}: { placeId: string; businessName: string; score: number }) {
  const [consentText, setConsentText] = useState(FALLBACK_CONSENT);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');           // honeypot: real people never see it
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPublicConfig().then(c => { if (alive && c?.consentText) setConsentText(c.consentText); });
    return () => { alive = false; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) { setError('יש לסמן את תיבת ההסכמה כדי להמשיך.'); return; }
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/public/audit/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, placeId, businessName, score, consent, website, ...utm() }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setError(body.error ?? 'לא הצלחנו לשמור. נסו שוב.'); return; }
      trackEvent('Audit_Lead_Captured', { score });
      setReviewUrl(body.reviewUrl ?? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`);
    } catch {
      setError('לא הצלחנו לשמור. בדקו את החיבור ונסו שוב.');
    } finally {
      setBusy(false);
    }
  }

  if (reviewUrl) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <CheckCircle2 size={16} /> תודה! קיבלנו את הפרטים ונשלח אליכם בוואטסאפ את תוכנית החיזוק.
        </p>
        <p className="text-sm text-slate-700">
          בינתיים, הדרך המהירה ביותר לחזק את הפרופיל: ביקורות חדשות. זה הקישור הישיר שאפשר לשלוח ללקוחות מרוצים, והוא פותח להם חלון דירוג בגוגל:
        </p>
        <input
          readOnly dir="ltr" value={reviewUrl} onFocus={e => e.currentTarget.select()}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
        />
        <a href={reviewUrl} target="_blank" rel="noopener noreferrer" className="self-start text-sm font-medium text-[#2E63F6] hover:underline">
          פתיחת חלון הדירוג
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 flex flex-col gap-3" noValidate>
      <p className="text-sm font-semibold text-slate-900">רוצים את תוכנית החיזוק המלאה בוואטסאפ?</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          שם
          <input
            value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="name"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          נייד
          <input
            value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" dir="ltr" maxLength={20}
            autoComplete="tel" placeholder="0501234567"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 text-right"
          />
        </label>
      </div>
      {/* honeypot */}
      <input
        tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={e => setWebsite(e.target.value)}
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
      />
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1" />
        <span>{consentText}</span>
      </label>
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      <button
        type="submit" disabled={busy}
        className="self-start rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2552d0] disabled:opacity-60"
      >
        {busy ? 'שולחים…' : 'שלחו לי את התוכנית'}
      </button>
      <p className="text-[11px] text-slate-400">אפשר לבקש הסרה בכל עת.</p>
    </form>
  );
}
