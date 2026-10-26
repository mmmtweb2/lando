import { useCallback, useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { authFetch } from '../lib/api';
import { RoleTag } from './RoleTag';
import ConciergeButton from './ConciergeButton';

// Counting inquiries that happen on the customer's OWN website. One <script> line on their
// site; it only reads clicks on phone, email and WhatsApp links and reports them to us, and
// they show up in the same leads feed as the Pagey pages' inquiries.

interface Saved { id: string; name: string }

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* visible text */ }
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? 'הועתק' : 'העתקת הקוד'}
    </button>
  );
}

export default function ExternalSiteCard() {
  const [list, setList] = useState<Saved[] | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await authFetch('/api/seo/businesses');
      if (!r.ok) { setList([]); return; }
      const body = await r.json().catch(() => ({}));
      setList(body.businesses ?? []);
    } catch { setList([]); }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('seo-businesses-changed', load);
    return () => window.removeEventListener('seo-businesses-changed', load);
  }, [load]);

  if (!list || list.length === 0) return null;
  const origin = window.location.origin;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">ספירת פניות באתר שלכם</h3>
        <p className="mt-1 text-sm text-slate-500">
          יש לכם אתר משלכם? הדביקו שורת קוד אחת בכל עמודי האתר, ונספור כמה אנשים לחצו על טלפון, וואטסאפ או אימייל. הפניות יופיעו יחד עם שאר הפניות שלכם.
        </p>
      </div>
      {list.map(b => {
        const snippet = `<script src="${origin}/w/track.js" data-b="${b.id}" async></script>`;
        return (
          <div key={b.id} className="rounded-lg border border-slate-200 p-4 flex flex-col gap-2">
            <div className="font-semibold text-slate-900">{b.name}</div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <RoleTag who="you" /> להדביק לפני סגירת התגית body באתר
            </div>
            <textarea
              readOnly dir="ltr" rows={2} value={snippet}
              onFocus={e => e.currentTarget.select()}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
            />
            <div><CopyBtn text={snippet} /></div>
            <ConciergeButton location="embed" businessName={b.name} />
            <p className="text-xs text-slate-500">
              הקוד לא אוסף פרטים אישיים: הוא שולח רק את סוג הלחיצה, כתובת העמוד ומאיפה הגיעו אליו. אנחנו סופרים לחיצות, לא שיחות או הודעות שנשלחו בפועל.
            </p>
          </div>
        );
      })}
    </div>
  );
}
