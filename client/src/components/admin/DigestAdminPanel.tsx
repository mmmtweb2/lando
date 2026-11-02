import { useState } from 'react';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** Admin: see the monthly summary email of an account, or send a test of it to yourself. Never emails the customer. */
export default function DigestAdminPanel({ adminFetch }: { adminFetch: Fetcher }) {
  const [email, setEmail] = useState('');
  const [html, setHtml] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function preview() {
    setBusy(true); setMsg(null); setHtml(null);
    try {
      const r = await adminFetch(`/api/admin/digest/preview?email=${encodeURIComponent(email.trim())}`);
      if (!r.ok) { setMsg({ ok: false, text: 'לא הצלחנו לבנות תצוגה.' }); return; }
      setHtml(await r.text());
    } catch { setMsg({ ok: false, text: 'לא הצלחנו לבנות תצוגה.' }); } finally { setBusy(false); }
  }
  async function sendTest() {
    setBusy(true); setMsg(null);
    try {
      const r = await adminFetch('/api/admin/digest/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() || undefined }) });
      const b = await r.json().catch(() => ({})) as { error?: string; to?: string; enabled?: boolean };
      setMsg(r.ok ? { ok: true, text: `נשלח אליך (${b.to}). ${b.enabled ? '' : 'שימו לב: השליחה האוטומטית לכולם כבויה.'}` } : { ok: false, text: b.error ?? 'השליחה נכשלה.' });
    } catch { setMsg({ ok: false, text: 'השליחה נכשלה.' }); } finally { setBusy(false); }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-700 text-sm">מייל חודשי ללקוחות: תצוגה ובדיקה</h2>
        <p className="text-xs text-slate-400 mt-0.5">הכתובת היא של הלקוח שרוצים לראות את הסיכום שלו. בדיקה נשלחת רק אליכם, אף פעם ללקוח.</p>
      </div>
      <div className="px-5 py-4 flex flex-wrap items-end gap-3">
        <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="customer@example.com"
          className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
        <button type="button" disabled={busy || !email.trim()} onClick={preview} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 disabled:opacity-50">תצוגה</button>
        <button type="button" disabled={busy || !email.trim()} onClick={sendTest} className="rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">שלחו לי בדיקה</button>
        {msg && <span role="status" className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
      {html && <iframe title="תצוגת המייל" sandbox="" srcDoc={html} className="w-full h-96 border-t border-slate-100" />}
    </div>
  );
}
