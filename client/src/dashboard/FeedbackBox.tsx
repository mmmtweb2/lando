import { useState } from 'react';
import { authFetch } from '../lib/api';

const KINDS: Array<{ key: 'bug' | 'idea' | 'other'; label: string }> = [
  { key: 'bug', label: 'משהו לא עובד' },
  { key: 'idea', label: 'רעיון לשיפור' },
  { key: 'other', label: 'אחר' },
];

/** Small, quiet feedback form at the bottom of the dashboard. `page` is a short label of the current view. */
export default function FeedbackBox({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'bug' | 'idea' | 'other'>('bug');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle');
  const [err, setErr] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await authFetch('/api/seo/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, message: text, page }),
      });
      const b = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) { setErr(b.error ?? 'לא הצלחנו לשלוח. נסו שוב.'); setState('error'); return; }
      setState('sent'); setText('');
    } catch { setErr('לא הצלחנו לשלוח. נסו שוב.'); setState('error'); } finally { setBusy(false); }
  }

  if (state === 'sent') {
    return <p role="status" className="mt-8 text-center text-sm text-[var(--muted)]">תודה! ההודעה הגיעה אלינו.{' '}
      <button type="button" className="underline" onClick={() => { setState('idle'); setOpen(false); }}>סגירה</button></p>;
  }
  if (!open) {
    return (
      <div className="mt-8 text-center">
        <button type="button" onClick={() => setOpen(true)} className="min-h-[44px] text-sm text-[var(--muted)] underline underline-offset-4 hover:text-[var(--navy)]">
          משהו לא עובד, או יש לכם רעיון? ספרו לנו
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={send} className="dv2-card-flat mx-auto mt-8 max-w-xl p-4" aria-label="משוב">
      <div role="radiogroup" aria-label="סוג ההודעה" className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} onClick={() => setKind(k.key)}
            className={`min-h-[44px] rounded-full border px-4 text-sm ${kind === k.key ? 'border-[var(--navy)] bg-[var(--navy)] text-white' : 'border-[var(--line)] bg-white text-[var(--navy)]'}`}>
            {k.label}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm text-[var(--ink)]">
        <span className="sr-only">ההודעה</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={4} required
          placeholder="מה קרה, או מה הייתם רוצים? אפשר לכתוב במילים שלכם."
          className="w-full rounded-xl border border-[var(--line)] bg-white p-3 text-sm" />
      </label>
      {state === 'error' && <p role="alert" className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy || text.trim().length < 3} className="dv2-btn disabled:opacity-50">שליחה</button>
        <button type="button" onClick={() => setOpen(false)} className="dv2-btn-ghost">ביטול</button>
      </div>
    </form>
  );
}
