import { useState } from 'react';
import { Card } from './adminUi';
import type { Fetcher } from './adminData';

interface Step { key: string; label: string; ok: boolean; skipped?: boolean; httpStatus?: number; googleStatus?: string; message?: string; reasons?: string[]; quota?: string[]; detail?: string; api?: string }
interface Diagnosis { at: string; email: string; verdict: string; summary: string; steps: Step[]; project: string | null }

const TONE: Record<string, string> = { works: 'bg-emerald-50 text-emerald-800 border-emerald-200' };

/** Read-only check of the Google Business Profile connection: every call, with Google's own error. */
export default function GbpDiagnosis({ adminFetch }: { adminFetch: Fetcher }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [d, setD] = useState<Diagnosis | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await adminFetch('/api/admin/seo/gbp-diagnose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() || undefined }) });
      const b = await r.json().catch(() => ({})) as Diagnosis & { error?: string };
      if (!r.ok) { setErr(b.error ?? 'האבחון נכשל.'); return; }
      setD(b);
    } catch { setErr('האבחון נכשל.'); } finally { setBusy(false); }
  }

  const report = d ? [
    `אבחון GBP ${new Date(d.at).toISOString()} · חשבון ${d.email}${d.project ? ` · פרויקט ${d.project}` : ''}`,
    `תוצאה: ${d.verdict} · ${d.summary}`,
    ...d.steps.map((s) => `${s.ok ? 'OK  ' : s.skipped ? 'SKIP' : 'FAIL'} ${s.label}${s.httpStatus ? ` [HTTP ${s.httpStatus}]` : ''}${s.googleStatus ? ` ${s.googleStatus}` : ''}${s.message ? ` | ${s.message}` : ''}${s.reasons?.length ? ` | reasons: ${s.reasons.join(', ')}` : ''}${s.quota?.length ? ` | ${s.quota.join('; ')}` : ''}${s.detail ? ` | ${s.detail}` : ''}`),
  ].join('\n') : '';

  return (
    <Card title="אבחון חיבור גוגל (Business Profile)" sub="קריאה בלבד. מריץ את כל הקריאות לפי הסדר ומציג את ההודעה המלאה של גוגל בכל שלב. עולה כמה קריאות API.">
      <form onSubmit={run} className="px-5 py-4 flex flex-wrap items-end gap-3 border-b border-slate-100">
        <label className="text-xs text-slate-500">מייל של חשבון מחובר (ריק = החשבון שלי)
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" placeholder="name@example.com" />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'בודק…' : 'הרצת אבחון'}</button>
        {err && <span role="alert" className="text-xs text-red-600">{err}</span>}
      </form>
      {d && (
        <div className="px-5 py-4 flex flex-col gap-4">
          <p className={`rounded-lg border px-3 py-2 text-sm ${TONE[d.verdict] ?? 'bg-amber-50 text-amber-900 border-amber-200'}`} role="status">{d.summary}</p>
          <ol className="flex flex-col gap-2">
            {d.steps.map((s) => (
              <li key={s.key} className="rounded-lg border border-slate-100 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">{s.label}</span>
                  <span className={s.ok ? 'text-emerald-600' : s.skipped ? 'text-slate-400' : 'text-red-600 font-medium'}>
                    {s.ok ? 'עבר' : s.skipped ? 'דולג' : 'נכשל'}{s.httpStatus ? ` · HTTP ${s.httpStatus}` : ''}{s.googleStatus ? ` · ${s.googleStatus}` : ''}
                  </span>
                </div>
                {s.api && <p className="text-xs text-slate-400" dir="ltr">{s.api}</p>}
                {s.detail && <p className="mt-1 text-xs text-slate-500">{s.detail}</p>}
                {s.message && <p className="mt-1 text-xs text-red-700 break-words" dir="auto">{s.message}</p>}
                {s.reasons?.length ? <p className="mt-1 text-xs text-slate-500" dir="ltr">reasons: {s.reasons.join(', ')}</p> : null}
                {s.quota?.length ? <ul className="mt-1 text-xs text-slate-500" dir="ltr">{s.quota.map((q) => <li key={q}>{q}</li>)}</ul> : null}
              </li>
            ))}
          </ol>
          <details>
            <summary className="cursor-pointer text-xs text-[#2E63F6]">טקסט להעתקה ולהדבקה בצ'אט</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700" dir="ltr">{report}</pre>
          </details>
        </div>
      )}
    </Card>
  );
}
