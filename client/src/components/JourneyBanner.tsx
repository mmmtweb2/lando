import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetch } from '../lib/api';
import { trackAccount } from '../lib/journeyClient';

// Dashboard banner for a customer whose setup is not finished ("continue where you stopped"), and
// the once-a-day "dashboard viewed" signal the server uses for the day-7 / day-30 activity events.
// Read-only: it never creates a journey for someone who never started one.

const TEXT: Record<string, string> = {
  registered: 'עוד לא בחרתם עסק. זה לוקח חצי דקה.',
  setup: 'נשארו המלצות לעבור עליהן, ואז מפעילים.',
  ready_to_activate: 'ההקמה הסתיימה. נשאר רק להפעיל.',
};

function today(): string { return new Date().toISOString().slice(0, 10); }

export default function JourneyBanner() {
  const [state, setState] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    authFetch('/api/seo/journey')
      .then(r => (r.ok ? r.json() : null))
      .then(v => {
        if (!alive || !v) return;
        if (v.started) setState(v.state);
        try {
          if (window.localStorage.getItem('pagey_dash_day') !== today()) {
            window.localStorage.setItem('pagey_dash_day', today());
            trackAccount('dashboard_viewed');
          }
        } catch { /* once per visit instead */ trackAccount('dashboard_viewed'); }
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  if (!state || !TEXT[state]) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3">
      <p className="text-sm text-slate-800">{TEXT[state]}</p>
      <Link to="/start" className="rounded-lg bg-[#2E63F6] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#2552d0]">להמשך ההקמה</Link>
    </div>
  );
}
