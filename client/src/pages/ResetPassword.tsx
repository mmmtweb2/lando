import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Page the Supabase password-reset email links to (redirectTo set in
// Login.tsx's handleForgotPassword). Supabase's recovery link, once opened,
// establishes a temporary session via detectSessionInUrl (see lib/supabase.ts),
// so by the time this page mounts supabase.auth.updateUser({ password }) is
// enough to set the new password — mirrors SetPasswordCard's submit pattern.
export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // A valid recovery link produces a session via detectSessionInUrl. If
    // there's no session by the time Supabase finishes processing the URL,
    // the link is missing, already used, or expired.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
      else setLinkInvalid(true);
    });
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) { setError('הסיסמה חייבת להכיל לפחות 6 תווים'); return; }
    if (password !== confirm) { setError('הסיסמאות אינן תואמות'); return; }

    setBusy(true);
    setError(null);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      setDone(true);
      setTimeout(() => navigate('/dashboard', { replace: true }), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לעדכן את הסיסמה, נסו שוב');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-800">Pagey ✦</h1>
          <p className="text-sm text-slate-500 mt-1">בונה דפי נחיתה חכם</p>
        </div>

        <div className="rounded-2xl bg-white shadow-lg shadow-slate-200/60 px-6 py-8">
          {linkInvalid ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <XCircle size={48} className="text-red-400" />
              <div>
                <p className="text-lg font-bold text-slate-800">הקישור אינו תקף</p>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed max-w-xs">
                  הקישור לאיפוס סיסמה פג תוקף או כבר נעשה בו שימוש. אפשר לבקש קישור חדש בעמוד ההתחברות.
                </p>
              </div>
              <button
                onClick={() => navigate('/login')}
                className="text-sm text-[#2E63F6] hover:text-[#0E2148] transition mt-1"
              >
                ← חזרה להתחברות
              </button>
            </div>
          ) : done ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-6 text-center"
            >
              <CheckCircle size={48} className="text-emerald-500" />
              <div>
                <p className="text-lg font-bold text-slate-800">הסיסמה עודכנה!</p>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">מעבירים אתכם לדשבורד…</p>
              </div>
            </motion.div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-800">הגדרת סיסמה חדשה</h2>
                <p className="text-sm text-slate-500 mt-1">בחרו סיסמה חדשה לחשבון שלכם</p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    <Lock size={15} className="text-[#2E63F6]" />
                    סיסמה חדשה
                  </label>
                  <input
                    type="password" autoFocus required dir="ltr"
                    placeholder="לפחות 6 תווים"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={!ready}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#8CA0D6] focus:ring-2 focus:ring-[#E4EAFB] transition disabled:opacity-50"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    <Lock size={15} className="text-[#2E63F6]" />
                    אימות סיסמה
                  </label>
                  <input
                    type="password" required dir="ltr"
                    placeholder="הזינו שוב את הסיסמה"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={!ready}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#8CA0D6] focus:ring-2 focus:ring-[#E4EAFB] transition disabled:opacity-50"
                  />
                </div>

                {error && (
                  <p className="text-xs text-red-500 rounded-lg bg-red-50 px-3 py-2 text-center border border-red-100">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy || !ready}
                  className="flex items-center justify-center gap-2 w-full rounded-xl bg-[#2E63F6] py-3 text-sm font-semibold text-white hover:bg-[#1E4FD6] active:scale-95 disabled:opacity-50 transition mt-1"
                >
                  {busy || !ready ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                  {busy ? 'שומר...' : !ready ? 'טוען...' : 'שמור סיסמה חדשה'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          ✦ Pagey
        </p>
      </motion.div>
    </div>
  );
}
