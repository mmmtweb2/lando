import { forwardRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';
import { type Audit, type AuditItem, isNumericValue, scoreStyle } from '../lib/auditShared';
import { trackEvent } from '../lib/track';

// Snapshot Mode (task #2): the Audit card as a sharp 1080x1350 PNG, made in the browser.
// What it shows: business name, score, the comparison line and the three main findings.
// What it never shows: review text (we do not have any here) — and the Google Maps
// attribution stays in the picture, like in the card.

export const SNAPSHOT_W = 1080;
export const SNAPSHOT_H = 1350;
const LEVEL_RANK: Record<AuditItem['level'], number> = { weak: 0, ok: 1, good: 2 };
const LEVEL_COLOR: Record<AuditItem['level'], string> = { weak: '#e11d48', ok: '#d97706', good: '#059669' };
// Rough room for finding text: ~34 Hebrew chars per line at this size, 14 lines in total.
const CHARS_PER_LINE = 34;
const LINE_BUDGET = 14;

/** The (up to) three findings to print: weakest first; never so long that the card overflows. */
export function pickFindings(items: AuditItem[]): AuditItem[] {
  const withTip = items.filter(i => i.tip).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  const out: AuditItem[] = [];
  let lines = 0;
  for (const i of withTip) {
    const need = Math.ceil(i.tip.length / CHARS_PER_LINE) + 1;
    if (out.length >= 3) break;
    if (out.length >= 2 && lines + need > LINE_BUDGET) break;
    out.push(i);
    lines += need;
  }
  return out;
}

export function comparisonLine(a: Audit): string {
  return a.benchmark
    ? `הציון נמדד מול שלושת העסקים המובילים מתוך ${a.benchmark.count} עסקים דומים באזור.`
    : 'לא היו מספיק עסקים דומים באזור, ולכן הציון נמדד מול יעדים כלליים.';
}

/** The card itself, at its real size. Rendered off-screen for export, or scaled in ?snapshot=1. */
export const SnapshotCard = forwardRef<HTMLDivElement, { audit: Audit }>(function SnapshotCard({ audit }, ref) {
  const hasGaps = audit.items.some(i => i.tip);
  const sc = scoreStyle(audit.score, hasGaps);
  const findings = pickFindings(audit.items);
  return (
    <div
      ref={ref}
      dir="rtl"
      style={{
        width: SNAPSHOT_W, height: SNAPSHOT_H, boxSizing: 'border-box', padding: 72, background: '#ffffff',
        fontFamily: "'Heebo', system-ui, sans-serif", color: '#0E2148', display: 'flex', flexDirection: 'column',
        justifyContent: 'space-between', overflow: 'hidden',
      }}
    >
      <div>
        <div style={{ fontSize: 30, color: '#64748b', fontWeight: 500 }}>בדיקת מצב העסק בגוגל מפות</div>
        <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.15, marginTop: 14, overflowWrap: 'anywhere' }}>{audit.name}</div>
        {audit.address && <div style={{ fontSize: 28, color: '#64748b', marginTop: 8, overflowWrap: 'anywhere' }}>{audit.address}</div>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
        <div
          style={{
            width: 260, height: 260, borderRadius: '50%', border: `18px solid ${sc.color}`, flexShrink: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: sc.color,
          }}
        >
          <span style={{ fontSize: 112, fontWeight: 900, lineHeight: 1 }}>{audit.score}</span>
          <span style={{ fontSize: 26, color: '#94a3b8', marginTop: 4 }}>מתוך 100</span>
        </div>
        <div>
          <div style={{ fontSize: 44, fontWeight: 800, color: sc.color, lineHeight: 1.2 }}>{sc.label}</div>
          {audit.rating !== null && (
            <div style={{ fontSize: 30, color: '#475569', marginTop: 12 }}>
              <bdi>★ {audit.rating.toFixed(1)}</bdi> · <bdi>{audit.reviewCount}</bdi> ביקורות
            </div>
          )}
          <div style={{ fontSize: 26, color: '#64748b', marginTop: 14, lineHeight: 1.4 }}>{comparisonLine(audit)}</div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 34, fontWeight: 800, marginBottom: 18 }}>
          {findings.length > 0 ? 'מה הכי כדאי לחזק' : 'הפרופיל במצב טוב'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {findings.map(f => (
            <div key={f.key} style={{ borderRadius: 20, background: '#f8fafc', border: '2px solid #e2e8f0', padding: '20px 26px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
                <span style={{ fontSize: 32, fontWeight: 800 }}>
                  <span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: 9, background: LEVEL_COLOR[f.level], marginInlineEnd: 12 }} />
                  {f.label}
                </span>
                <span style={{ fontSize: 30, fontWeight: 800, color: LEVEL_COLOR[f.level] }} dir={isNumericValue(f.value) ? 'ltr' : undefined}>{f.value}</span>
              </div>
              <div style={{ fontSize: 26, color: '#475569', marginTop: 8, lineHeight: 1.4 }}>{f.tip}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 26, color: '#64748b' }}>
        <span>מקור הנתונים: Google Maps</span>
        <span style={{ fontWeight: 800, color: '#2E63F6', fontSize: 32 }} dir="ltr">pagey.co.il/audit</span>
      </div>
    </div>
  );
});

function fileSafe(name: string): string {
  const s = name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'audit';
}

/** "Download as image" button. The card is rendered off-screen at full size and exported 1:1. */
export function SnapshotButton({ audit }: { audit: Audit }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function download() {
    if (!node) return;
    setBusy(true); setErr('');
    try {
      try { await document.fonts?.ready; } catch { /* fonts are best effort */ }
      const url = await toPng(node, { width: SNAPSHOT_W, height: SNAPSHOT_H, pixelRatio: 1, cacheBust: true });
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${fileSafe(audit.name)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      trackEvent('Snapshot_Downloaded');
    } catch {
      setErr('לא הצלחנו ליצור את התמונה. נסו שוב.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button" onClick={download} disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} הורד כתמונה
      </button>
      {err && <span className="text-xs text-rose-700" role="alert">{err}</span>}
      {/* Off-screen, full size: html-to-image measures real pixels. aria-hidden: it is only an export source. */}
      <div aria-hidden="true" style={{ position: 'fixed', left: -20000, top: 0, pointerEvents: 'none' }}>
        <SnapshotCard ref={setNode} audit={audit} />
      </div>
    </div>
  );
}
