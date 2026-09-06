import { useState } from 'react';
import { Lock, ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Lets a logged-in user set/update a password. Solves the "signed up via magic
// link → no password → must request a new link every time" problem: after
// setting one here, they can sign in with email + password.
export default function SetPasswordCard() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);

  async function submit() {
    if (password.length < 6) {
      setStatus({ text: 'הסיסמה חייבת להכיל לפחות 6 תווים', ok: false });
      return;
    }
    setBusy(true);
    setStatus(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setStatus({ text: 'לא הצלחנו לשמור: ' + error.message, ok: false });
    } else {
      setStatus({ text: 'הסיסמה נשמרה! מעכשיו אפשר להתחבר עם אימייל + סיסמה.', ok: true });
      setPassword('');
    }
  }

  return (
    <section className="rounded-xl bg-white border border-slate-200 p-5">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 w-full text-right">
        <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
          <Lock size={15} className="text-slate-500" />
        </span>
        <span className="text-sm font-semibold text-slate-900">הגדרת סיסמה</span>
        <span className="text-sm text-slate-500 mr-auto hidden sm:block">
          התחברת עם קישור? הגדר סיסמה לכניסה מהירה בפעם הבאה
        </span>
        <ChevronDown size={16} className={`text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password" dir="ltr" placeholder="סיסמה חדשה (לפחות 6 תווים)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-[#2E63F6] focus:ring-2 focus:ring-[#2E63F6]/15 transition"
            />
            <button
              onClick={submit} disabled={busy}
              className="rounded-lg bg-[#2E63F6] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#1E4FD6] transition disabled:opacity-50"
            >
              {busy ? 'שומר…' : 'שמור סיסמה'}
            </button>
          </div>
          {status && (
            <p className={`mt-2.5 text-xs ${status.ok ? 'text-emerald-600' : 'text-red-600'}`}>{status.text}</p>
          )}
        </div>
      )}
    </section>
  );
}
