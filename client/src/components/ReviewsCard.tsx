import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, MessageCircle, QrCode, Eye } from 'lucide-react';
import { authFetch } from '../lib/api';
import { RoleTag } from './RoleTag';
import QrModal from './QrModal';

// Stage 6.2 — get more Google reviews and show them.
//   • The review link only needs the saved place_id (no Google content involved).
//   • The widget is an <iframe> served by us (/w/reviews/:id). It reads the reviews live
//     from Google on every view: Places terms do not allow us to store or cache them.

interface Saved { id: string; name: string; google_place_id: string | null }

const reviewUrl = (placeId: string) =>
  `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch { /* clipboard blocked: the text is visible and selectable */ }
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? 'הועתק' : label}
    </button>
  );
}

function BusinessReviews({ b }: { b: Saved }) {
  const [qr, setQr] = useState(false);
  const [preview, setPreview] = useState(false);
  const placeId = b.google_place_id!;
  const link = reviewUrl(placeId);
  const widgetSrc = `${window.location.origin}/w/reviews/${b.id}`;
  const snippet =
    `<iframe src="${widgetSrc}" title="ביקורות Google" width="100%" height="560" ` +
    `style="border:0;max-width:640px" loading="lazy"></iframe>`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`היי, תודה שבחרת ב${b.name}! נשמח אם תכתבו לנו ביקורת בגוגל, זה לוקח דקה: ${link}`)}`;

  return (
    <div className="rounded-lg border border-slate-200 p-4 flex flex-col gap-4">
      <div className="font-semibold text-slate-900">{b.name}</div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <RoleTag who="you" /> לשלוח ללקוחות מרוצים קישור לכתיבת ביקורת
        </div>
        <input
          readOnly
          dir="ltr"
          value={link}
          onFocus={e => e.currentTarget.select()}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
        />
        <div className="flex flex-wrap gap-2">
          <CopyBtn text={link} label="העתקת הקישור" />
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <MessageCircle size={14} /> שליחה בוואטסאפ
          </a>
          <button
            type="button"
            onClick={() => setQr(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <QrCode size={14} /> קוד QR להדפסה
          </button>
        </div>
        <p className="text-xs text-slate-500">
          כדאי לבקש ביקורת מכל לקוח, לא רק ממי שהיה מרוצה: גוגל אוסרת לסנן את מי שמבקשים ממנו.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <RoleTag who="we" /> ווידג'ט ביקורות לאתר שלכם
        </div>
        <p className="text-xs text-slate-500">
          הדביקו את הקוד באתר, במקום שבו תרצו להציג ביקורות. הווידג'ט מושך את הביקורות מגוגל בכל צפייה,
          מציג עד 5 ביקורות לפי בחירת גוגל, ומקשר לביקורת המקורית.
        </p>
        <textarea
          readOnly
          dir="ltr"
          rows={3}
          value={snippet}
          onFocus={e => e.currentTarget.select()}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
        />
        <div className="flex flex-wrap gap-2">
          <CopyBtn text={snippet} label="העתקת קוד ההטמעה" />
          <button
            type="button"
            onClick={() => setPreview(p => !p)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Eye size={14} /> {preview ? 'הסתרת תצוגה' : 'תצוגה מקדימה'}
          </button>
        </div>
        {preview && (
          <iframe
            src={widgetSrc}
            title="תצוגה מקדימה של ווידג'ט הביקורות"
            className="w-full rounded-lg border border-slate-200"
            style={{ height: 560, maxWidth: 640 }}
          />
        )}
      </div>

      {qr && <QrModal url={link} title={`QR לביקורת: ${b.name}`} onClose={() => setQr(false)} />}
    </div>
  );
}

export default function ReviewsCard() {
  const [list, setList] = useState<Saved[] | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await authFetch('/api/seo/businesses');
      if (!r.ok) { setList([]); return; }
      const body = await r.json().catch(() => ({}));
      setList((body.businesses ?? []).filter((b: Saved) => !!b.google_place_id));
    } catch { setList([]); }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener('seo-businesses-changed', load);
    return () => window.removeEventListener('seo-businesses-changed', load);
  }, [load]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">ביקורות בגוגל</h3>
        <p className="mt-1 text-sm text-slate-500">
          ביקורות הן מהגורמים החזקים ביותר בדירוג בגוגל מפות. אנחנו נותנים לכם את הכלים, ואתם מבקשים מהלקוחות.
        </p>
      </div>
      {list === null ? null : list.length === 0 ? (
        <p className="text-sm text-slate-500">
          חברו קודם את העסק שלכם בבדיקה למעלה ("זה העסק שלי, חברו אותו"), ואז יופיעו כאן קישור לביקורת וווידג'ט.
        </p>
      ) : (
        list.map(b => <BusinessReviews key={b.id} b={b} />)
      )}
    </div>
  );
}
