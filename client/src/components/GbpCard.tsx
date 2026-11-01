import { useCallback, useEffect, useState } from 'react';
import { Phone, Navigation, MousePointerClick, Eye } from 'lucide-react';
import { authFetch } from '../lib/api';

// Business Profile numbers of the customer's own Google account (Stage 6.3). Shown only when the
// server says the feature is on. The numbers are read live from Google and are not stored here.

interface Totals { calls: number; directions: number; website: number; impressions: number }
type Stats =
  | { kind: 'ok'; title: string; totals: Totals }
  | { kind: 'choose'; locations: { name: string; title: string }[] }
  | { kind: 'reconnect' }
  | { kind: 'error'; detail: string };

const RETURN_MSG: Record<string, string> = {
  ok: 'החשבון חובר. עוד רגע נציג את הנתונים.',
  denied: 'לא אישרתם את החיבור, ולא נעשה שינוי.',
  error: 'החיבור לא הושלם. נסו שוב.',
};

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="dv2-card-flat p-3">
      <div className="text-[var(--muted)]" aria-hidden>{icon}</div>
      <div className="mt-1.5 text-3xl font-bold leading-none tabular-nums text-[var(--ink)]">{value.toLocaleString('he-IL')}</div>
      <div className="mt-1 text-sm text-[var(--muted)]">{label}</div>
    </div>
  );
}

export default function GbpCard() {
  const [status, setStatus] = useState<{ enabled: boolean; connected: boolean; needsReconnect: boolean } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');
  let returnMsg = '';
  try { returnMsg = RETURN_MSG[new URLSearchParams(window.location.search).get('gbp') ?? ''] ?? ''; } catch { /* none */ }

  const loadStats = useCallback(async () => {
    setStats(null);
    try {
      const r = await authFetch('/api/seo/gbp/stats');
      const b = await r.json().catch(() => ({}));
      if (r.status === 409) setStats({ kind: 'reconnect' });
      else if (!r.ok) setStats({ kind: 'error', detail: typeof b.detail === 'string' ? b.detail : '' });
      else if (b.needsChoice) setStats({ kind: 'choose', locations: b.locations ?? [] });
      else setStats({ kind: 'ok', title: b.location?.title ?? '', totals: b.totals });
    } catch { setStats({ kind: 'error', detail: '' }); }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const r = await authFetch('/api/seo/gbp/status');
      const s = r.ok ? await r.json() : null;
      setStatus(s);
      if (s?.enabled && s.connected && !s.needsReconnect) loadStats();
    } catch { setStatus(null); }
  }, [loadStats]);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function connect() {
    setBusy(true); setErr('');
    try {
      const r = await authFetch('/api/seo/gbp/oauth/start');
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.url) { setErr(b.error ?? 'משהו השתבש. נסו שוב.'); return; }
      window.location.href = b.url;
    } catch { setErr('משהו השתבש. נסו שוב.'); } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setErr('');
    try {
      const r = await authFetch('/api/seo/gbp/disconnect', { method: 'POST' });
      if (!r.ok) { setErr('משהו השתבש. נסו שוב.'); return; }
      setConfirming(false); setStats(null); await loadStatus();
    } catch { setErr('משהו השתבש. נסו שוב.'); } finally { setBusy(false); }
  }
  async function choose(name: string) {
    setBusy(true); setErr('');
    try {
      const r = await authFetch('/api/seo/gbp/location', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: name }) });
      if (!r.ok) { setErr('משהו השתבש. נסו שוב.'); return; }
      await loadStats();
    } catch { setErr('משהו השתבש. נסו שוב.'); } finally { setBusy(false); }
  }

  if (!status || !status.enabled) return returnMsg && status ? <p className="dv2-card-flat p-4 text-sm text-[var(--ink)]">{returnMsg}</p> : null;

  const connectBtn = (label: string) => (
    <button type="button" disabled={busy} onClick={connect} className="dv2-btn mt-3 disabled:opacity-50">{label}</button>
  );

  return (
    <section className="dv2-card p-5 sm:p-6" aria-labelledby="gbp-title">
      <h2 id="gbp-title" className="text-lg font-bold text-[var(--ink)]">הנתונים של הפרופיל בגוגל</h2>
      {returnMsg && <p className="mt-1 text-sm text-[var(--ink)]">{returnMsg}</p>}
      {err && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}

      {!status.connected && (
        <>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            מחברים את חשבון גוגל שמנהל את הפרופיל, ורואים כמה אנשים התקשרו, ביקשו הגעה או נכנסו לאתר ב-30 הימים האחרונים. אנחנו קוראים נתונים בלבד ולא משנים דבר בפרופיל. אפשר לנתק בכל רגע.
          </p>
          {connectBtn('חיבור חשבון גוגל')}
        </>
      )}

      {status.connected && status.needsReconnect && (
        <>
          <p className="mt-1 text-sm text-[var(--muted)]">החיבור לגוגל פג או בוטל. כדי לראות נתונים צריך להתחבר מחדש.</p>
          {connectBtn('חיבור מחדש')}
        </>
      )}

      {status.connected && !status.needsReconnect && !stats && <p className="mt-2 text-sm text-[var(--muted)]" aria-busy="true">טוענים נתונים מגוגל…</p>}

      {status.connected && !status.needsReconnect && stats?.kind === 'reconnect' && (
        <>
          <p className="mt-1 text-sm text-[var(--muted)]">החיבור לגוגל פג או בוטל. כדי לראות נתונים צריך להתחבר מחדש.</p>
          {connectBtn('חיבור מחדש')}
        </>
      )}
      {stats?.kind === 'error' && (
        <>
          <p className="mt-1 text-sm text-[var(--muted)]">לא הצלחנו לקרוא את הנתונים מגוגל כרגע.</p>
          {stats.detail && <p className="mt-1 break-words text-xs text-[var(--muted)]" dir="ltr">{stats.detail}</p>}
          <button type="button" className="dv2-btn-ghost mt-3" onClick={loadStats}>נסו שוב</button>
        </>
      )}
      {stats?.kind === 'choose' && (
        <>
          <p className="mt-1 text-sm text-[var(--muted)]">בחשבון כמה עסקים. איזה מהם להציג?</p>
          <ul className="mt-3 flex flex-col gap-2">
            {stats.locations.map((l) => (
              <li key={l.name}><button type="button" disabled={busy} className="dv2-btn-ghost" onClick={() => choose(l.name)}>{l.title || l.name}</button></li>
            ))}
          </ul>
          {stats.locations.length === 0 && <p className="mt-2 text-sm text-[var(--muted)]">לא נמצאו עסקים בחשבון גוגל שחובר. אפשר לנתק ולחבר חשבון אחר.</p>}
        </>
      )}
      {stats?.kind === 'ok' && (
        <>
          <p className="mt-1 text-sm text-[var(--muted)]">{stats.title ? `${stats.title}, ` : ''}30 הימים האחרונים. גוגל מעדכנת עם עיכוב של יומיים בערך.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile icon={<Phone size={18} />} label="לחיצות להתקשרות" value={stats.totals.calls} />
            <Tile icon={<Navigation size={18} />} label="בקשות הגעה" value={stats.totals.directions} />
            <Tile icon={<MousePointerClick size={18} />} label="כניסות לאתר" value={stats.totals.website} />
            <Tile icon={<Eye size={18} />} label="חשיפות בגוגל" value={stats.totals.impressions} />
          </div>
        </>
      )}

      {status.connected && (
        <div className="mt-4 border-t border-[var(--line)] pt-3">
          {!confirming ? (
            <button type="button" className="min-h-[44px] text-sm font-semibold text-[var(--muted)] underline" onClick={() => setConfirming(true)}>ניתוק החשבון</button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-[var(--ink)]">לנתק? נפסיק לקרוא נתונים ונבטל את ההרשאה.</span>
              <button type="button" disabled={busy} className="dv2-btn-ghost" onClick={disconnect}>כן, לנתק</button>
              <button type="button" className="dv2-btn-ghost" onClick={() => setConfirming(false)}>לא</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
