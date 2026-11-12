import { useEffect, useId, useState } from 'react';
import { Check, Copy, Eye } from 'lucide-react';
import { authFetch } from '../../../lib/api';
import { reviewsWidget } from '../../../lib/reviewRequestMsg';
import { KIT, REVIEWS_AREA } from '../autopilotCopy';

// "הצגת ביקורות באתר שלכם": the code of the reviews widget, the third and last part of the automatic
// product's reviews area. Closed until asked for: most owners never need it. (The link, the message
// and the QR that used to sit next to it are in the kit above, once.)

interface Saved { id: string; name: string; google_place_id: string | null }

function Widget({ b, single, preview }: { b: Saved; single: boolean; preview: boolean }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const { src, snippet } = reviewsWidget(b.id);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked: the code is visible and can be selected */ }
  };
  return (
    <div className="dv4-kit-part">
      <label htmlFor={id} className={single ? 'sr-only' : undefined}>{REVIEWS_AREA.embedCode(b.name)}</label>
      <textarea id={id} className="dv3-a-input" readOnly dir="ltr" rows={3} value={snippet} onFocus={(e) => e.currentTarget.select()} />
      <div className="dv4-kit-actions">
        <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={() => void copy()}>
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          <span aria-live="polite">{copied ? KIT.copied : REVIEWS_AREA.embedCopy}</span>
        </button>
        {/* the sample business has no widget on the server to show */}
        {!preview && (
          <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" aria-expanded={shown} onClick={() => setShown((v) => !v)}>
            <Eye size={16} aria-hidden />{shown ? REVIEWS_AREA.embedHide : REVIEWS_AREA.embedShow}
          </button>
        )}
      </div>
      {shown && <iframe src={src} title={REVIEWS_AREA.embedFrame} className="dv4-embed-frame" />}
    </div>
  );
}

export default function ReviewsEmbed({ fetcher = authFetch, preview = false }: { fetcher?: typeof authFetch; preview?: boolean }) {
  const [list, setList] = useState<Saved[] | null>(null);
  useEffect(() => {
    let live = true;
    fetcher('/api/seo/businesses').then((r) => (r.ok ? r.json() : { businesses: [] }))
      .then((b: { businesses?: Saved[] }) => { if (live) setList((b.businesses ?? []).filter((x) => !!x.google_place_id)); })
      .catch(() => { if (live) setList([]); });
    return () => { live = false; };
  }, [fetcher]);
  // Without a connected business there is no widget to offer, so the part is not there at all.
  if (!list || list.length === 0) return null;
  return (
    <details className="dv4-card dv4-embed">
      <summary>{REVIEWS_AREA.embedTitle}</summary>
      <div className="dv4-embed-body">
        <p className="dv4-quiet">{REVIEWS_AREA.embedLead}</p>
        {list.map((b) => <Widget key={b.id} b={b} single={list.length === 1} preview={preview} />)}
      </div>
    </details>
  );
}
