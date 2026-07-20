import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, ExternalLink, Copy, Check, LogOut, Sparkles, Tag, Share2, Gift } from 'lucide-react';
import { useUser } from '../context/UserContext';
import { authFetch } from '../lib/api';
import { LandoBot } from '../components/Lando';

interface PageRecord {
  id: string;
  slug: string;
  business_name: string;
  created_at: string;
  logo_url: string | null;
  image_source: string;
}

const item      = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } };
const container = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1 text-xs text-[#2E63F6] hover:text-[#0E2148] transition font-medium"
      title="העתק">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'הועתק!' : 'העתק'}
    </button>
  );
}

function ShareLinkButton({ affiliateCode }: { affiliateCode: string }) {
  const [toastVisible, setToastVisible] = useState(false);

  function copyShareLink() {
    const url = `${window.location.origin}/login?ref=${affiliateCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setToastVisible(true);
      setTimeout(() => setToastVisible(false), 2500);
    });
  }

  return (
    <>
      <button
        onClick={copyShareLink}
        className="flex items-center gap-2 rounded-xl bg-[#2E63F6] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E4FD6] transition active:scale-95 shadow-sm"
      >
        <Share2 size={15} />
        העתק קישור שיתוף
      </button>

      {/* Toast */}
      <AnimatePresence>
        {toastVisible && (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-slate-900 text-white text-sm font-medium px-5 py-3 shadow-xl"
          >
            <Check size={16} className="text-emerald-400" />
            הקישור הועתק ללוח!
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default function ClientPortal() {
  const { user, setUser } = useUser();
  const navigate = useNavigate();
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    authFetch('/api/landing/my-pages')
      .then((r) => r.json())
      .then((data) => setPages(Array.isArray(data) ? data : []))
      .catch(() => setPages([]))
      .finally(() => setPagesLoading(false));
  }, [user, navigate]);

  if (!user) return null;

  function signOut() {
    setUser(null);
    navigate('/login', { replace: true });
  }

  const earnedCoupons  = user.earned_coupons  ?? 0;
  const signupDiscount = user.signup_discount  ?? false;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-[#EEF1FB]/30" dir="rtl">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-100/60 shadow-sm">
        <div className="max-w-5xl mx-auto h-14 flex items-center justify-between px-4">
          <button onClick={signOut}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition">
            <LogOut size={15} />
            יציאה
          </button>
          <span className="text-base font-bold" style={{ color: 'var(--navy)' }}>Lando</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10 flex flex-col gap-10">
        {/* Welcome */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-800">
              שלום, <span className="text-[#2E63F6] font-mono text-xl">{user.email}</span>
            </h1>
            {signupDiscount && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1">
                <Tag size={11} />
                10% הנחה פעילה
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">ברוכים הבאים לפורטל הניהול שלכם</p>
        </motion.div>

        {/* Create new button */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
          <Link to="/create"
            className="inline-flex items-center gap-2 rounded-xl bg-[#2E63F6] px-5 py-3 text-sm font-semibold text-white shadow-md hover:bg-[#1E4FD6] transition">
            <Plus size={16} />
            צור דף חדש
          </Link>
        </motion.div>

        {/* Pages grid */}
        <section>
          <h2 className="text-base font-semibold text-slate-700 mb-4">הדפים שלך</h2>

          {pagesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-2xl bg-white border border-slate-100 p-5 flex flex-col gap-3 animate-pulse">
                  <div className="w-10 h-10 rounded-xl bg-slate-100" />
                  <div className="h-3.5 rounded-full bg-slate-100 w-3/4" />
                  <div className="h-2.5 rounded-full bg-slate-100 w-1/2" />
                </div>
              ))}
            </div>
          ) : pages.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center flex flex-col items-center gap-3">
              <div className="lando-hover"><LandoBot mood="default" size={88} /></div>
              <p className="text-sm text-slate-500">עדיין לא יצרתם דפים</p>
              <Link to="/create" className="text-sm font-medium text-[#2E63F6] hover:underline">
                צרו את הדף הראשון שלכם ✦
              </Link>
            </div>
          ) : (
            <motion.div
              variants={container} initial="hidden" animate="visible"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {pages.map((p) => (
                <motion.div key={p.id} variants={item}
                  className="rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    {p.logo_url
                      ? <img src={p.logo_url} alt={p.business_name} className="w-10 h-10 rounded-xl object-contain bg-slate-50" />
                      : <div className="w-10 h-10 rounded-xl bg-[#E4EAFB] flex items-center justify-center text-[#2E63F6] font-bold text-sm">
                          {p.business_name.charAt(0)}
                        </div>
                    }
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 text-sm truncate">{p.business_name}</p>
                      <p className="text-xs text-slate-400 font-mono">/p/{p.slug}</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">{formatDate(p.created_at)}</p>
                  <Link to={`/p/${p.slug}`} target="_blank" rel="noopener noreferrer"
                    className="mt-auto flex items-center gap-1.5 text-xs font-medium text-[#2E63F6] hover:text-[#0E2148] transition">
                    <ExternalLink size={12} />
                    צפייה בדף
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          )}
        </section>

        {/* Partner Program section */}
        <motion.section
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="rounded-2xl bg-gradient-to-br from-[#EEF1FB] to-[#EEF1FB] border border-[#E4EAFB] p-6 flex flex-col gap-6"
        >
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-[#2E63F6]" />
            <h2 className="text-base font-semibold text-slate-800">תוכנית שותפים — Give &amp; Get</h2>
          </div>

          {/* How it works callout */}
          <div className="rounded-xl bg-white/70 border border-[#E4EAFB] px-4 py-3 text-xs text-slate-600 leading-relaxed flex gap-2">
            <Gift size={15} className="flex-shrink-0 text-[#8CA0D6] mt-0.5" />
            <span>
              שתפו את הקישור שלכם — כל חבר שנרשם מקבל <strong>10% הנחה</strong> על הדף הראשון שלו,
              ואתם מקבלים <strong>קופון 20% הנחה</strong> לשימוש בעתיד.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Affiliate code */}
            <div className="rounded-xl bg-white border border-[#E4EAFB] p-4 flex flex-col gap-2">
              <p className="text-xs text-slate-500 font-medium">קוד השותף שלכם</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xl font-black tracking-widest text-[#1E4FD6] font-mono">
                  {user.affiliate_code}
                </span>
                <CopyButton text={user.affiliate_code} />
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                ניתן לשתף ישירות את הקוד בנפרד
              </p>
            </div>

            {/* Share link */}
            <div className="rounded-xl bg-white border border-[#E4EAFB] p-4 flex flex-col gap-3">
              <p className="text-xs text-slate-500 font-medium">קישור שיתוף</p>
              <p className="text-xs text-slate-400 font-mono truncate leading-relaxed">
                {window.location.origin}/login?ref={user.affiliate_code}
              </p>
              <div className="mt-auto">
                <ShareLinkButton affiliateCode={user.affiliate_code} />
              </div>
            </div>

            {/* Coupons earned */}
            <div className="rounded-xl bg-white border border-[#E4EAFB] p-4 flex flex-col gap-2">
              <p className="text-xs text-slate-500 font-medium">קופונים שהרווחתם</p>
              <div className="flex items-end gap-1">
                <span className="text-3xl font-black text-[#1E4FD6]">{earnedCoupons}</span>
                <span className="text-sm text-slate-400 mb-1">קופונים</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: earnedCoupons > 0 ? '#059669' : '#94a3b8' }}>
                {earnedCoupons > 0
                  ? `יש לך ${earnedCoupons} קופון${earnedCoupons > 1 ? 'ים' : ''} של 20% הנחה למימוש 🎉`
                  : 'הזמינו חברים כדי לצבור קופונים'}
              </p>
            </div>
          </div>

          {/* AI image credits */}
          <div className="rounded-xl bg-white border border-[#E4EAFB] p-4 flex items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-xs text-slate-500 font-medium">קרדיטים לתמונות AI</p>
              <p className="text-xs text-slate-400 leading-relaxed">
                כל קרדיט מאפשר יצירת תמונה אחת עם AI לדף הנחיתה שלכם
              </p>
            </div>
            <div className="flex items-end gap-1 flex-shrink-0">
              <span className="text-3xl font-black text-[#1E4FD6]">{user.credits}</span>
              <span className="text-sm text-slate-400 mb-1">קרדיטים</span>
            </div>
          </div>
        </motion.section>
      </main>
    </div>
  );
}
