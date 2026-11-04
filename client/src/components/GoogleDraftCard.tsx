import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { authFetch } from '../lib/api';

// "Create a landing page from your Google business card". Shown in "My pages" only for
// connected businesses that have a Google card and no linked landing page yet. The link
// opens the wizard, which fetches the details once, shows them for the user to review and
// creates a DRAFT. Nothing is fetched from Google here; this only lists saved businesses.

interface Biz { id: string; name: string; google_place_id?: string | null; landing_page_id?: string | null }

export default function GoogleDraftCard() {
  const [items, setItems] = useState<Biz[]>([]);
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await authFetch('/api/seo/businesses');
        if (!r.ok) return;
        const body = (await r.json().catch(() => ({}))) as { businesses?: Biz[] };
        if (!off) setItems((body.businesses ?? []).filter((b) => b.google_place_id && !b.landing_page_id));
      } catch { /* optional card: stay hidden */ }
    })();
    return () => { off = true; };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/50 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <Sparkles size={16} className="mt-0.5 text-[#2E63F6] shrink-0" />
        <div>
          <h3 className="text-sm font-semibold text-slate-900">אפשר ליצור דף נחיתה מנתוני העסק בגוגל</h3>
          <p className="mt-0.5 text-xs text-slate-500">נמלא מראש שם, טלפון, כתובת ושעות. אתם בודקים ומתקנים, והדף נוצר כטיוטה.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((b) => (
          <Link
            key={b.id}
            to={`/create?from=google&business=${encodeURIComponent(b.id)}`}
            className="inline-flex items-center rounded-lg bg-[#2E63F6] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2552d4]"
          >
            {b.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
