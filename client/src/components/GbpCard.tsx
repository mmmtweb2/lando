import { useCallback, useEffect, useState } from 'react';
import { Phone, Navigation, MousePointerClick, Eye } from 'lucide-react';
import { authFetch } from '../lib/api';

// Business-card numbers of the customer's own Google account (Stage 6.3). Shown only when the
// server says the feature is on. The numbers are read live from Google and are not stored here.

interface Totals { calls: number; directions: number; website: number; impressions: number }
/** Server: does the listing this Google account manages match the business picked in the search? */
interface PlaceMatch {
  status: 'match' | 'mismatch' | 'unknown';
  selected: { id: string; name: string; placeId: string | null } | null;
  connected: { title: string; placeId: string | null };
}
type Stats =
  | { kind: 'ok'; title: string; totals: Totals; match?: PlaceMatch; locations?: { name: string; title: string }[] }
  | { kind: 'choose'; locations: { name: string; title: string }[] }
  | { kind: 'reconnect' }
  | { kind: 'error' }
  | { kind: 'quota' };

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
      else if (b.code === 'quota_pending') setStats({ kind: 'quota' });
      else if (!r.ok) setStats({ kind: 'error' }); // the technical detail the server may send is never shown
      else if (b.needsChoice) setStats({ kind: 'choose', locations: b.locations ?? [] });
      else setStats({ kind: 'ok', title: b.location?.title ?? '', totals: b.totals, match: b.match, locations: b.locations });
    } catch { setStats({ kind: 'error' }); }
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
  const [showOthers, setShowOthers] = useState(false);
  async function adoptConnected(replaceId: string | undefined) {
    setBusy(true); setErr('');
    try {
      const r = await authFetch('/api/seo/gbp/use-connected', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(replaceId ? { replaceId } : {}) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(typeof b.error === 'string' ? b.error : 'משהו השתבש. נסו שוב.'); return; }
      window.dispatchEvent(new Event('seo-businesses-changed'));
      await loadStats();
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
      <h2 id="gbp-title" className="text-lg font-bold text-[var(--ink)]">הנתונים של כרטיס העסק בגוגל</h2>
      {returnMsg && <p className="mt-1 text-sm text-[var(--ink)]">{returnMsg}</p>}
      {err && <p className="mt-2 text-sm text-red-600" role="alert">{err}</p>}

      {!status.connected && (
        <>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            מחברים את חשבון גוגל שמנהל את כרטיס העסק, ורואים כמה אנשים התקשרו, ביקשו הגעה או נכנסו לאתר ב-30 הימים האחרונים. אנחנו קוראים נתונים בלבד ולא משנים דבר בכרטיס העסק. אפשר לנתק בכל רגע.
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
      {stats?.kind === 'quota' && (
        <p className="mt-1 text-sm text-[var(--muted)]">החשבון חובר בהצלחה. הנתונים יופיעו ברגע שגוגל תאשר לנו גישה לממשק הנתונים שלה. אנחנו מטפלים בזה, אין צורך לעשות כלום.</p>
      )}
      {stats?.kind === 'error' && (
        <>
          <p className="mt-1 text-sm text-[var(--muted)]">לא הצלחנו לקרוא את הנתונים מגוגל כרגע. נסו שוב בעוד כמה דקות.</p>
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
      {stats?.kind === 'ok' && stats.match?.status === 'mismatch' && (
        <div className="mt-3 rounded-[10px] border border-amber-300 bg-amber-50 p-4" role="alert" aria-labelledby="gbp-mismatch">
          <p id="gbp-mismatch" className="text-[15px] font-bold text-[var(--ink)]">הכרטיס שחובר בגוגל הוא לא העסק שבחרתם</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--ink)]">
            בחרתם בחיפוש את <b>{stats.match.selected?.name || 'העסק'}</b>, אבל חשבון הגוגל שחיברתם מנהל את <b>{stats.match.connected.title || 'כרטיס אחר'}</b>.
            הנתונים למטה הם של הכרטיס המחובר. מה נכון?
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" disabled={busy} className="dv2-btn disabled:opacity-50" onClick={() => void adoptConnected(stats.match?.selected?.id)}>
              {stats.match.connected.title ? `העסק שלי הוא ${stats.match.connected.title}` : 'הכרטיס המחובר הוא העסק שלי'}
            </button>
            {(stats.locations?.length ?? 0) > 1 && (
              <button type="button" disabled={busy} className="dv2-btn-ghost" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
                בחירת כרטיס אחר מאותו חשבון
              </button>
            )}
            <button type="button" disabled={busy} className="dv2-btn-ghost" onClick={() => setConfirming(true)}>
              חיבור עם חשבון גוגל אחר
            </button>
          </div>
          {showOthers && (
            <ul className="mt-3 flex flex-col gap-2">
              {stats.locations!.map((l) => (
                <li key={l.name}><button type="button" disabled={busy} className="dv2-btn-ghost" onClick={() => { setShowOthers(false); void choose(l.name); }}>{l.title || l.name}</button></li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-[var(--muted)]">כדי לנהל כרטיס בגוגל צריך להתחבר עם חשבון הגוגל שמנהל אותו (בעלים או מנהל). חיבור עם חשבון אחר: מנתקים כאן ומתחברים מחדש.</p>
        </div>
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
