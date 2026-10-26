import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BusinessAuditCard from '../components/BusinessAuditCard';
import { SNAPSHOT_H, SNAPSHOT_W, SnapshotCard } from '../components/AuditSnapshot';
import { getPublicConfig } from '../lib/publicConfig';
import type { Audit } from '../lib/auditShared';

// /audit — the public, signed-out Audit (task #1). Anyone can look up a business and see the
// score; leaving a phone number is optional and needs an explicit, unticked consent box.
//
// /audit?snapshot=1&placeId=… — clean mode (task #2): only the 1080x1350 card, scaled to fit the
// screen, with no navigation, buttons or footer (for screenshots). The "download as image"
// button in the normal card produces the same picture.

function SnapshotOnly({ placeId }: { placeId: string }) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? SNAPSHOT_W : window.innerWidth));

  useEffect(() => {
    let alive = true;
    fetch(`/api/public/audit/${encodeURIComponent(placeId)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('audit failed'))))
      .then(b => { if (alive) setAudit(b.audit as Audit); })
      .catch(() => { if (alive) setFailed(true); });
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => { alive = false; window.removeEventListener('resize', onResize); };
  }, [placeId]);

  if (failed) return <p className="p-6 text-center text-sm text-slate-500">לא הצלחנו להציג את הבדיקה כרגע.</p>;
  if (!audit) return <p className="p-6 text-center text-sm text-slate-500">טוענים…</p>;
  const scale = Math.min(1, width / SNAPSHOT_W);
  return (
    <div style={{ width: SNAPSHOT_W * scale, height: SNAPSHOT_H * scale, margin: '0 auto', overflow: 'hidden' }}>
      <div style={{ width: SNAPSHOT_W, height: SNAPSHOT_H, transform: `scale(${scale})`, transformOrigin: 'top left' }} dir="ltr">
        <SnapshotCard audit={audit} />
      </div>
    </div>
  );
}

export default function PublicAudit() {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const snapshotId = params.get('snapshot') === '1' ? params.get('placeId') : null;
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    document.title = 'בדיקת פרופיל העסק בגוגל מפות, בחינם | Pagey';
    let alive = true;
    getPublicConfig().then(c => { if (alive) setEnabled(c ? c.auditEnabled : null); });
    return () => { alive = false; };
  }, []);

  if (snapshotId && /^[A-Za-z0-9_-]{10,300}$/.test(snapshotId)) return <SnapshotOnly placeId={snapshotId} />;

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-extrabold text-[#2E63F6]">Pagey</Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">איך העסק שלכם נראה בגוגל מפות?</h1>
          <p className="mt-2 text-sm text-slate-600">
            הקלידו את שם העסק והעיר, וקבלו תוך שניות ציון והשוואה לשלושת העסקים המובילים באזור שלכם. בלי הרשמה.
          </p>
        </div>
        {enabled === false && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            הבדיקה החינמית תהיה זמינה בקרוב.
          </p>
        )}
        <BusinessAuditCard mode="public" />
      </main>
      <footer className="mx-auto max-w-2xl px-4 pb-10 text-center text-xs text-slate-400">
        <Link to="/privacy" className="hover:underline">פרטיות</Link> · <Link to="/terms" className="hover:underline">תנאי שימוש</Link>
      </footer>
    </div>
  );
}
