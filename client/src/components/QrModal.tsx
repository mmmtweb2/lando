import { useEffect, useState } from 'react';
import { X, Download } from 'lucide-react';

interface Props {
  url: string;
  title: string;
  onClose: () => void;
}

// QR code for a published page. The `qrcode` library is loaded on demand so it
// stays out of the main bundle. Rendered at 1024px (error correction "M") so the
// downloaded PNG is sharp enough to print on a flyer or business card.
export default function QrModal({ url, title, onClose }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import('qrcode')
      .then((QR) => QR.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M' }))
      .then((d) => { if (!cancelled) setDataUrl(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fileName = `qr-${url.split('/').pop() ?? 'page'}.png`;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="relative w-full max-w-xs rounded-2xl bg-white p-6 shadow-2xl text-center"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="קוד QR לדף"
      >
        <button
          onClick={onClose}
          aria-label="סגירה"
          className="absolute top-3 left-3 text-slate-400 hover:text-slate-700"
        >
          <X size={18} />
        </button>
        <h3 className="text-base font-bold text-slate-800 mb-1">קוד QR לדף</h3>
        <p className="text-xs text-slate-500 mb-4 truncate">{title}</p>
        <div className="aspect-square w-full rounded-xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
          {dataUrl && <img src={dataUrl} alt={`קוד QR לדף ${title}`} className="w-full h-full" />}
          {!dataUrl && !failed && <span className="text-xs text-slate-400">יוצר קוד…</span>}
          {failed && <span className="text-xs text-red-500">יצירת הקוד נכשלה</span>}
        </div>
        <p className="mt-3 text-[11px] text-slate-400 font-mono" dir="ltr">{url}</p>
        <a
          href={dataUrl ?? undefined}
          download={fileName}
          aria-disabled={!dataUrl}
          className={`mt-4 inline-flex items-center justify-center gap-2 w-full rounded-xl bg-[#2E63F6] text-white text-sm font-bold py-2.5 transition-colors ${dataUrl ? 'hover:bg-[#1E4FD6]' : 'opacity-50 pointer-events-none'}`}
        >
          <Download size={15} />
          הורדת תמונה (PNG)
        </a>
        <p className="mt-2 text-[11px] text-slate-400">אפשר להדפיס על כרטיס ביקור, פלייר או חלון הראווה</p>
      </div>
    </div>
  );
}
