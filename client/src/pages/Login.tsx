import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Loader2, CheckCircle, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { trackEvent } from '../lib/analytics';
import { translateAuthError } from '../lib/authErrors';

type Mode = 'signin' | 'signup' | 'forgot';
type InfoScreen = null | 'magic' | 'confirm' | 'reset';

/** Where to go after signing in: ?next=/some/path (same site only), else the dashboard. */
function nextPath(search: string): string {
  try {
    const n = new URLSearchParams(search).get('next') ?? '';
    return /^\/[A-Za-z0-9/_-]*$/.test(n) && !n.startsWith('//') ? n : '/dashboard';
  } catch { return '/dashboard'; }
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>(() => (new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'signin'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [info, setInfo] = useState<InfoScreen>(null);
  const [error, setError] = useState<string | null>(null);

  // Arrives from AuthErrorRedirect (App.tsx) when a magic-link/reset/invite
  // email link has expired or was already used — surfaced in the same error
  // banner as any other auth failure, instead of the link silently landing
  // on the marketing homepage with no explanation.
  useEffect(() => {
    const state = location.state as { authError?: string } | null;
    if (state?.authError) {
      setError(state.authError);
      window.history.replaceState({}, '', location.pathname);
    }
  }, [location]);

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
        trackEvent('signup_attempt');
        const { data, error: signErr } = await supabase.auth.signUp({
          email: trimmed,
          password,
          options: { emailRedirectTo: `${window.location.origin}${nextPath(location.search)}` },
        });
        if (signErr) throw signErr;
        // Supabase returns an obfuscated user with EMPTY identities when the email
        // already exists (anti-enumeration). Tell the user the truth instead of
        // showing a misleading "check your email" screen.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError('כתובת המייל כבר רשומה. התחברו עם הסיסמה, או לחצו על "שכחתי סיסמה" כדי להגדיר סיסמה, אם נרשמתם בעבר עם קישור.');
          setMode('signin');
          return;
        }
        // If email confirmation is OFF, a session is returned → straight in.
        if (data.session) navigate(nextPath(location.search), { replace: true });
        else setInfo('confirm');
      } else {
        const { error: signErr } = await supabase.auth.signInWithPassword({ email: trimmed, password });
        if (signErr) throw signErr;
        navigate(nextPath(location.search), { replace: true });
      }
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  // ── Forgot password (send reset email) ────────────────────────────────────
  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!validEmail(trimmed)) { setError('נא להזין כתובת אימייל תקינה'); return; }

    setForgotLoading(true);
    setError(null);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetErr) throw resetErr;
      setInfo('reset');
    } catch (err) {
      setError(translateAuthError(err));
    } finally {
      setForgotLoading(false);
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
        options: { emailRedirectTo: `${window.location.origin}${nextPath(location.search)}` },
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
          <h1 className="text-2xl font-bold text-slate-800">Pagey ✦</h1>
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
                <p className="text-lg font-bold text-slate-800">בדקו את תיבת המייל שלכם 📩</p>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {info === 'magic'
                    ? 'שלחנו קישור התחברות לכתובת '
                    : info === 'reset'
                    ? 'שלחנו קישור לאיפוס סיסמה לכתובת '
                    : 'שלחנו קישור אימות לכתובת '}
                  <span dir="ltr" className="font-mono font-medium text-slate-700">{email}</span>
                </p>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed max-w-xs">
                {info === 'magic'
                  ? 'לחצו על הקישור במייל כדי להיכנס לדשבורד.'
                  : info === 'reset'
                  ? 'לחצו על הקישור במייל כדי להגדיר סיסמה חדשה.'
                  : 'אשרו את כתובת המייל ואז תוכלו להתחבר עם הסיסמה שלכם.'}
              </p>
              <button
                onClick={() => { setInfo(null); setMode('signin'); setPassword(''); }}
                className="text-sm text-[#2E63F6] hover:text-[#0E2148] transition mt-1"
              >
                ← חזרה
              </button>
            </motion.div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-slate-800">
                  {mode === 'signin' ? 'כניסה לדשבורד' : mode === 'signup' ? 'יצירת חשבון' : 'איפוס סיסמה'}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {mode === 'signin'
                    ? 'התחברו עם האימייל והסיסמה שלכם'
                    : mode === 'signup'
                    ? 'בחרו אימייל וסיסמה כדי להתחיל'
                    : 'הזינו את כתובת האימייל שלכם ונשלח קישור לאיפוס הסיסמה'}
                </p>
              </div>

              {mode === 'forgot' ? (
                <form onSubmit={handleForgotPassword} className="flex flex-col gap-4" noValidate>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="forgot-email" className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                      <Mail size={15} className="text-[#2E63F6]" aria-hidden="true" />
                      כתובת אימייל
                    </label>
                    <input
                      id="forgot-email" name="email" autoComplete="email"
                      type="email" autoFocus required dir="ltr"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#8CA0D6] focus:ring-2 focus:ring-[#E4EAFB] transition"
                    />
                  </div>

                  {error && (
                    <p role="alert" className="text-xs text-red-700 rounded-lg bg-red-50 px-3 py-2 text-center border border-red-100">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="flex items-center justify-center gap-2 w-full rounded-xl bg-[#2E63F6] py-3 text-sm font-semibold text-white hover:bg-[#1E4FD6] active:scale-95 disabled:opacity-50 transition mt-1"
                  >
                    {forgotLoading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                    {forgotLoading ? 'שולחים...' : 'שליחת קישור לאיפוס'}
                  </button>

                  <button
                    type="button"
                    onClick={() => { setMode('signin'); setError(null); }}
                    className="text-sm text-[#2E63F6] hover:text-[#0E2148] transition"
                  >
                    ← חזרה להתחברות
                  </button>
                </form>
              ) : (
                <>
                  <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4" noValidate>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="login-email" className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                        <Mail size={15} className="text-[#2E63F6]" aria-hidden="true" />
                        כתובת אימייל
                      </label>
                      <input
                        id="login-email" name="email" autoComplete="email"
                        type="email" autoFocus required dir="ltr"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#8CA0D6] focus:ring-2 focus:ring-[#E4EAFB] transition"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="login-password" className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                          <Lock size={15} className="text-[#2E63F6]" aria-hidden="true" />
                          סיסמה
                        </label>
                        {mode === 'signin' && (
                          <button
                            type="button"
                            onClick={() => { setMode('forgot'); setError(null); }}
                            className="text-xs text-[#2E63F6] hover:text-[#0E2148] transition"
                          >
                            שכחתי סיסמה
                          </button>
                        )}
                      </div>
                      <input
                        id="login-password" name="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                        type="password" required dir="ltr"
                        placeholder="לפחות 6 תווים"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#8CA0D6] focus:ring-2 focus:ring-[#E4EAFB] transition"
                      />
                    </div>

                    {error && (
                      <p role="alert" className="text-xs text-red-700 rounded-lg bg-red-50 px-3 py-2 text-center border border-red-100">
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="flex items-center justify-center gap-2 w-full rounded-xl bg-[#2E63F6] py-3 text-sm font-semibold text-white hover:bg-[#1E4FD6] active:scale-95 disabled:opacity-50 transition mt-1"
                    >
                      {loading ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                      {loading ? 'רגע...' : mode === 'signin' ? 'התחברות' : 'יצירת חשבון'}
                    </button>
                  </form>

                  <div className="mt-4 text-center text-sm text-slate-500">
                    {mode === 'signin' ? (
                      <button onClick={() => { setMode('signup'); setError(null); }} className="text-[#2E63F6] hover:text-[#0E2148] transition">
                        אין לכם חשבון? הרשמה →
                      </button>
                    ) : (
                      <button onClick={() => { setMode('signin'); setError(null); }} className="text-[#2E63F6] hover:text-[#0E2148] transition">
                        כבר יש לכם חשבון? התחברות →
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-3 my-5">
                    <div className="h-px flex-1 bg-slate-100" />
                    <span className="text-xs text-slate-600">או</span>
                    <div className="h-px flex-1 bg-slate-100" />
                  </div>

                  <button
                    onClick={handleMagicLink}
                    disabled={magicLoading}
                    className="flex items-center justify-center gap-2 w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 active:scale-95 disabled:opacity-50 transition"
                  >
                    {magicLoading ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                    {magicLoading ? 'שולחים...' : 'התחברות עם קישור למייל (ללא סיסמה)'}
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-600">
          ✦ Pagey
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
          <Link to="/terms" className="inline-flex min-h-[44px] items-center hover:text-[#2E63F6] transition">תנאי שימוש</Link>
          <Link to="/privacy" className="inline-flex min-h-[44px] items-center hover:text-[#2E63F6] transition">מדיניות פרטיות</Link>
          <Link to="/accessibility" className="inline-flex min-h-[44px] items-center hover:text-[#2E63F6] transition">הצהרת נגישות</Link>
        </div>
      </motion.div>
    </div>
  );
}
