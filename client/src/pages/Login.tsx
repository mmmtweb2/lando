import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Loader2, CheckCircle, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';
type InfoScreen = null | 'magic' | 'confirm';

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [info, setInfo] = useState<InfoScreen>(null);
  const [error, setError] = useState<string | null>(null);

  function validEmail(v: string) {
    return v.includes('@');
  }

  // ── Email + password (sign in / sign up) ──────────────────────────────────
  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!validEmail(trimmed)) { setError('נא להזין כתובת אימייל תקינה'); return; }
    if (password.length < 6) { setError('הסיסמה חייבת להכיל לפחות 6 תווים'); return; }

    setLoading(true);
    setError(null);
    try {
      if (mode === 'signup') {
        const { data, error: signErr } = await supabase.auth.signUp({ email: trimmed, password });
        if (signErr) throw signErr;
        // Supabase returns an obfuscated user with EMPTY identities when the email
        // already exists (anti-enumeration). Tell the user the truth instead of
        // showing a misleading "check your email" screen.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError('כתובת המייל כבר רשומה. התחברו עם הסיסמה, או הגדירו סיסמה ב-Supabase אם נרשמתם בעבר עם קישור.');
          setMode('signin');
          return;
        }
        // If email confirmation is OFF, a session is returned → straight in.
        if (data.session) navigate('/dashboard', { replace: true });
        else setInfo('confirm');
      } else {
        const { error: signErr } = await supabase.auth.signInWithPassword({ email: trimmed, password });
        if (signErr) throw signErr;
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Magic link (passwordless fallback) ────────────────────────────────────
  async function handleMagicLink() {
    const trimmed = email.trim().toLowerCase();
    if (!validEmail(trimmed)) { setError('נא להזין כתובת אימייל תקינה'); return; }
    setMagicLoading(true);
    setError(null);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      if (otpError) throw otpError;
      setInfo('magic');
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setMagicLoading(false);
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
          {info ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-4 py-6 text-center"
            >
              <CheckCircle size={48} className="text-emerald-500" />
              <div>
                <p className="text-lg font-bold text-slate-800">בדוק את תיבת המייל שלך 📩</p>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {info === 'magic' ? 'שלחנו קישור התחברות לכתובת ' : 'שלחנו קישור אימות לכתובת '}
                  <span dir="ltr" className="font-mono font-medium text-slate-700">{email}</span>
                </p>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
                {info === 'magic'
                  ? 'לחץ על הקישור במייל כדי להיכנס לדשבורד.'
                  : 'אשר את כתובת המייל ואז תוכל להתחבר עם הסיסמה שלך.'}
              </p>
              <button
                onClick={() => { setInfo(null); setPassword(''); }}
                className="text-sm text-[#2E63F6] hover:text-[#0E2148] transition mt-1"
              >
                ← חזרה
              </button>
            </motion.div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-800">
                  {mode === 'signin' ? 'כניסה לדשבורד' : 'יצירת חשבון'}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {mode === 'signin'
                    ? 'התחברו עם האימייל והסיסמה שלכם'
                    : 'בחרו אימייל וסיסמה כדי להתחיל'}
                </p>
              </div>

              <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    <Mail size={15} className="text-[#2E63F6]" />
                    כתובת אימייל
                  </label>
                  <input
                    type="email" autoFocus required dir="ltr"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#8CA0D6] focus:ring-2 focus:ring-[#E4EAFB] transition"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                    <Lock size={15} className="text-[#2E63F6]" />
                    סיסמה
                  </label>
                  <input
                    type="password" required dir="ltr"
                    placeholder="לפחות 6 תווים"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#8CA0D6] focus:ring-2 focus:ring-[#E4EAFB] transition"
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
                  className="flex items-center justify-center gap-2 w-full rounded-xl bg-[#2E63F6] py-3 text-sm font-semibold text-white hover:bg-[#1E4FD6] active:scale-95 disabled:opacity-50 transition mt-1"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                  {loading ? 'רגע...' : mode === 'signin' ? 'התחבר' : 'צור חשבון'}
                </button>
              </form>

              <div className="mt-4 text-center text-sm text-slate-500">
                {mode === 'signin' ? (
                  <button onClick={() => { setMode('signup'); setError(null); }} className="text-[#2E63F6] hover:text-[#0E2148] transition">
                    אין לך חשבון? הרשמה →
                  </button>
                ) : (
                  <button onClick={() => { setMode('signin'); setError(null); }} className="text-[#2E63F6] hover:text-[#0E2148] transition">
                    כבר יש לך חשבון? התחברות →
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3 my-5">
                <div className="h-px flex-1 bg-slate-100" />
                <span className="text-xs text-slate-400">או</span>
                <div className="h-px flex-1 bg-slate-100" />
              </div>

              <button
                onClick={handleMagicLink}
                disabled={magicLoading}
                className="flex items-center justify-center gap-2 w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 active:scale-95 disabled:opacity-50 transition"
              >
                {magicLoading ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                {magicLoading ? 'שולח...' : 'התחבר עם קישור למייל (ללא סיסמה)'}
              </button>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          ✦ Tirnoer Digital
        </p>
      </motion.div>
    </div>
  );
}

// Friendly Hebrew messages for the common Supabase auth errors.
function translateAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  if (/invalid login credentials/i.test(msg)) return 'אימייל או סיסמה שגויים';
  if (/already registered|already exists/i.test(msg)) return 'כתובת המייל כבר רשומה — נסו להתחבר';
  if (/password should be at least/i.test(msg)) return 'הסיסמה חייבת להכיל לפחות 6 תווים';
  if (/email not confirmed/i.test(msg)) return 'יש לאשר קודם את כתובת המייל (בדקו את תיבת הדואר)';
  return msg || 'שגיאת התחברות, נסו שוב';
}
