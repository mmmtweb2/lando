import { useState, FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Mail, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setError('נא להזין כתובת אימייל תקינה');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (otpError) throw otpError;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאה בשליחת קישור ההתחברות');
    } finally {
      setLoading(false);
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
          <h1 className="text-2xl font-bold text-slate-800">Tirnoer Digital ✦</h1>
          <p className="text-sm text-slate-500 mt-1">בונה דפי נחיתה חכם</p>
        </div>

        <div className="rounded-2xl bg-white shadow-lg shadow-slate-200/60 px-6 py-8">
          {sent ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-6 text-center"
            >
              <CheckCircle size={48} className="text-emerald-500" />
              <div>
                <p className="text-lg font-bold text-slate-800">בדוק את תיבת המייל שלך 📩</p>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  שלחנו קישור התחברות לכתובת{' '}
                  <span dir="ltr" className="font-mono font-medium text-slate-700">{email}</span>
                </p>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
                לחץ על הקישור במייל כדי להיכנס לדשבורד. הקישור תקף ל-60 דקות.
              </p>
              <button
                onClick={() => { setSent(false); setEmail(''); }}
                className="text-sm text-indigo-600 hover:text-indigo-800 transition mt-1"
              >
                שלח שוב לכתובת אחרת ←
              </button>
            </motion.div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-800">כניסה לדשבורד</h2>
                <p className="text-sm text-slate-500 mt-1">
                  הזינו את האימייל שלכם ונשלח קישור התחברות ישירות לתיבה
                </p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    <Mail size={15} className="text-indigo-500" />
                    כתובת אימייל
                  </label>
                  <input
                    type="email"
                    autoFocus
                    required
                    dir="ltr"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
                  />
                </div>

                {error && (
                  <p className="text-xs text-red-500 rounded-lg bg-red-50 px-3 py-2 text-center border border-red-100">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center justify-center gap-2 w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition mt-1"
                >
                  {loading
                    ? <Loader2 size={16} className="animate-spin" />
                    : <Mail size={16} />
                  }
                  {loading ? 'שולח...' : 'שלח לי קישור התחברות'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          ✦ Tirnoer Digital — ללא סיסמאות, ללא כאב ראש
        </p>
      </motion.div>
    </div>
  );
}
