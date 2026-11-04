import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RotateCcw, RotateCw, FlipHorizontal2, RefreshCw } from 'lucide-react';

// A small in-browser photo editor for page images: rotate, flip, zoom and move inside a crop
// frame. The result is drawn to a canvas and handed back as a JPEG File, which the caller uploads
// through the normal image-upload endpoint (so nothing new on the server, and no AI credits).

type Ratio = { key: string; label: string; value: number | null };
const RATIOS: Ratio[] = [
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
  { key: '1:1', label: 'ריבוע', value: 1 },
  { key: 'orig', label: 'מקורי', value: null },
];

const MAX_ZOOM = 4;

export interface EditState {
  rot: 0 | 90 | 180 | 270;
  flip: boolean;
  zoom: number;
  /** Pan as a fraction of the frame (−0.5..0.5 of its size), so preview and export agree. */
  ox: number;
  oy: number;
}

/** Draws the image into a W×H frame according to the edit state (shared by preview and export). */
export function drawEdited(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  W: number,
  H: number,
  st: EditState,
): void {
  const swap = st.rot === 90 || st.rot === 270;
  const iw = swap ? img.height : img.width;
  const ih = swap ? img.width : img.height;
  const cover = Math.max(W / iw, H / ih);
  const scale = cover * st.zoom;
  // Clamp the pan so the image always covers the whole frame (never an empty edge).
  const maxX = Math.max(0, (iw * scale - W) / 2);
  const maxY = Math.max(0, (ih * scale - H) / 2);
  const tx = Math.max(-maxX, Math.min(maxX, st.ox * W));
  const ty = Math.max(-maxY, Math.min(maxY, st.oy * H));
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2 + tx, H / 2 + ty);
  ctx.rotate((st.rot * Math.PI) / 180);
  if (st.flip) ctx.scale(-1, 1);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
}

export default function ImageEditor({
  src,
  defaultRatio = '4:3',
  primaryColor,
  onCancel,
  onSave,
}: {
  src: string;
  defaultRatio?: string;
  primaryColor: string;
  onCancel: () => void;
  onSave: (file: File) => Promise<void> | void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [ratioKey, setRatioKey] = useState(defaultRatio);
  const [st, setSt] = useState<EditState>({ rot: 0, flip: false, zoom: 1, ox: 0, oy: 0 });
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => { if (alive) setImg(el); };
    el.onerror = () => { if (alive) setLoadError(true); };
    el.src = src;
    return () => { alive = false; };
  }, [src]);

  const frame = useMemo(() => {
    const maxW = Math.min(340, typeof window !== 'undefined' ? window.innerWidth - 64 : 340);
    const swap = st.rot === 90 || st.rot === 270;
    const r = RATIOS.find((x) => x.key === ratioKey)?.value
      ?? (img ? (swap ? img.height / img.width : img.width / img.height) : 4 / 3);
    const w = r >= 1 ? maxW : Math.round(maxW * r);
    return { w, h: Math.round(w / r), r };
  }, [ratioKey, img, st.rot]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.width = frame.w * 2;
    c.height = frame.h * 2;
    drawEdited(ctx, img, c.width, c.height, st);
  }, [img, st, frame]);

  const patch = useCallback((p: Partial<EditState>) => setSt((s) => ({ ...s, ...p })), []);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: st.ox, oy: st.oy };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    patch({ ox: d.ox + (e.clientX - d.x) / frame.w, oy: d.oy + (e.clientY - d.y) / frame.h });
  }
  function onPointerUp() { drag.current = null; }

  function rotate(dir: 1 | -1) {
    setSt((s) => ({ ...s, rot: ((s.rot + dir * 90 + 360) % 360) as EditState['rot'], ox: 0, oy: 0 }));
  }

  async function save() {
    if (!img || busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      const outW = 1600;
      const out = document.createElement('canvas');
      out.width = outW;
      out.height = Math.round(outW / frame.r);
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('canvas');
      drawEdited(ctx, img, out.width, out.height, st);
      const blob: Blob | null = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) throw new Error('blob');
      await onSave(new File([blob], 'edited.jpg', { type: 'image/jpeg' }));
    } catch {
      setSaveError('לא הצלחנו לשמור את התמונה הערוכה. אפשר להעלות אותה מחדש מהמכשיר ולערוך.');
      setBusy(false);
    }
  }

  const iconBtn = 'w-10 h-10 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-50';

  return (
    <div className="flex flex-col gap-4">
      {loadError ? (
        <p className="text-sm text-red-500 leading-snug">
          לא ניתן לערוך את התמונה הזו מהדפדפן. אפשר להעלות אותה שוב מהמכשיר ואז לערוך.
        </p>
      ) : !img ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin text-slate-400" /></div>
      ) : (
        <>
          <div className="flex items-center justify-center">
            <canvas
              ref={canvasRef}
              style={{ width: frame.w, height: frame.h, touchAction: 'none', cursor: 'grab' }}
              className="rounded-xl border border-slate-200 bg-slate-100 max-w-full"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label="תצוגת עריכה. גררו כדי להזיז את התמונה"
            />
          </div>
          <p className="text-[11px] text-slate-400 text-center -mt-2">גוררים כדי להזיז. המסגרת היא מה שיוצג בדף.</p>

          <div className="flex items-center justify-center gap-2" role="group" aria-label="יחס מסגרת">
            {RATIOS.map((r) => (
              <button key={r.key} type="button" onClick={() => { setRatioKey(r.key); setSt((s) => ({ ...s, ox: 0, oy: 0 })); }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border transition"
                style={ratioKey === r.key ? { backgroundColor: primaryColor, color: '#fff', borderColor: primaryColor } : { borderColor: '#e2e8f0', color: '#475569' }}>
                {r.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2">
            <button type="button" className={iconBtn} onClick={() => rotate(-1)} title="סיבוב שמאלה" aria-label="סיבוב שמאלה"><RotateCcw size={18} /></button>
            <button type="button" className={iconBtn} onClick={() => rotate(1)} title="סיבוב ימינה" aria-label="סיבוב ימינה"><RotateCw size={18} /></button>
            <button type="button" className={iconBtn} onClick={() => patch({ flip: !st.flip })} title="היפוך" aria-label="היפוך אופקי"><FlipHorizontal2 size={18} /></button>
            <button type="button" className={iconBtn} onClick={() => setSt({ rot: 0, flip: false, zoom: 1, ox: 0, oy: 0 })} title="איפוס" aria-label="איפוס"><RefreshCw size={18} /></button>
          </div>

          <label className="flex items-center gap-3 text-xs text-slate-500">
            זום
            <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={st.zoom}
              onChange={(e) => patch({ zoom: Number(e.target.value) })} className="flex-1" aria-label="זום" />
          </label>
        </>
      )}

      {saveError && <p className="text-xs text-red-500 leading-snug">{saveError}</p>}

      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} disabled={busy}
          className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          חזרה
        </button>
        <button type="button" onClick={save} disabled={busy || !img}
          className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
          style={{ backgroundColor: primaryColor }}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          שמירה
        </button>
      </div>
    </div>
  );
}
