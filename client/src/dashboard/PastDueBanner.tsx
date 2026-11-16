import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { authFetch } from '../lib/api';

// The monthly charge failed (subscription "past_due"). One clear action: re-enter the card, which opens
// the same SUMIT payment page as "עדכון כרטיס וחידוש" in the subscription card. The date access ends is
// the period end plus the server's grace window (PAST_DUE_GRACE_DAYS in entitlements.service.ts).

const GRACE_DAYS = 7;

function accessEnd(periodEnd: string | null | undefined): string {
  if (!periodEnd) return '';
  const t = new Date(periodEnd).getTime();
  if (!Number.isFinite(t)) return '';
  try { return new Date(t + GRACE_DAYS * 86_400_000).toLocaleDateString('he-IL'); } catch { return ''; }
}

export default function PastDueBanner({ onDetails, className, buttonClass }: { onDetails: () => void; className: string; buttonClass: string }) {
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    authFetch('/api/seo/subscription')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (alive) setUntil(accessEnd(b?.subscription?.currentPeriodEnd)); })
      .catch(() => { /* the banner works without the date */ });
    return () => { alive = false; };
  }, []);

  async function renew() {
    setBusy(true); setErr('');
    try {
      const r = await authFetch('/api/seo/subscription/start', { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (r.ok && typeof body.redirectUrl === 'string' && body.redirectUrl) { window.location.href = body.redirectUrl; return; }
      setErr(body.error ?? 'משהו השתבש. נסו שוב.');
    } catch { setErr('משהו השתבש. נסו שוב.'); } finally { setBusy(false); }
  }

  return (
    <section className={className} role="alert">
      <div>
        <p><strong>התשלום החודשי לא עבר</strong></p>
        <p>{until ? `הקידום ממשיך עד ${until}. כדי שלא ייעצר, עדכנו את הכרטיס.` : 'כדי שהקידום לא ייעצר, עדכנו את הכרטיס בימים הקרובים.'}</p>
        {err && <p role="status">{err}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass} disabled={busy} onClick={renew}>
          {busy ? 'פותחים תשלום…' : 'עדכון כרטיס'} <ArrowLeft size={16} aria-hidden />
        </button>
        <button type="button" onClick={onDetails} className="min-h-[44px] text-sm underline underline-offset-4">לפרטי המנוי</button>
      </div>
    </section>
  );
}
