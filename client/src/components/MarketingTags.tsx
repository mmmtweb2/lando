import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CONSENT_KEY, loadGtm, marketingPath, readConsent, writeConsent, type Consent } from '../lib/gtm';
import { getPublicConfig } from '../lib/publicConfig';

/**
 * Marketing measurement (Google Tag Manager). Does nothing unless the server has GTM_CONTAINER_ID.
 * Loads only on public marketing pages and only after the visitor presses "אישור".
 */
export default function MarketingTags() {
  const { pathname } = useLocation();
  const [gtmId, setGtmId] = useState<string | null>(null);
  const [consent, setConsent] = useState<Consent>(() => readConsent());
  const on = marketingPath(pathname);

  useEffect(() => { let alive = true; void getPublicConfig().then((c) => { if (alive) setGtmId(c?.gtmId ?? null); }); return () => { alive = false; }; }, []);
  useEffect(() => { if (gtmId && consent === 'granted' && on) loadGtm(gtmId); }, [gtmId, consent, on]);
  useEffect(() => {
    const sync = (e: StorageEvent) => { if (e.key === CONSENT_KEY) setConsent(readConsent()); };
    window.addEventListener('storage', sync); return () => window.removeEventListener('storage', sync);
  }, []);

  if (!gtmId || !on || consent !== null) return null;
  const choose = (v: 'granted' | 'denied') => { writeConsent(v); setConsent(v); };
  return (
    <div role="region" aria-label="הסכמה למדידה" dir="rtl"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-lg">
      <p className="min-w-[200px] flex-1">
        נשתמש בכלי מדידה שיווקיים כדי להבין איך מגיעים אלינו ולשפר את השירות. בלי אישור לא נטען שום כלי.{' '}
        <Link to="/privacy#cookies" className="underline">פרטים</Link>
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => choose('granted')} className="min-h-[44px] rounded-lg bg-[#2E63F6] px-4 font-medium text-white">אישור</button>
        <button type="button" onClick={() => choose('denied')} className="min-h-[44px] rounded-lg border border-slate-200 px-4">לא תודה</button>
      </div>
    </div>
  );
}
