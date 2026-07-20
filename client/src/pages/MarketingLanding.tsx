import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Zap, Globe, Smartphone, Palette, MessageSquare,
  Check, ChevronDown, ArrowLeft, Wand2, Rocket,
} from 'lucide-react';
import { LandoBot, LandoMark, type LandoMood } from '../components/Lando';

// ─── Brand ────────────────────────────────────────────────────────────────────
// Single source of truth — change here to rebrand.
const BRAND = 'Lando';
const PRIMARY = '#2E63F6';   // Lando blue
const NAVY = '#0E2148';      // text / dark elements
const GLOW = '#6FE7FF';      // cyan energy accent
const GRAD = '#2E63F6';      // flat brand fill — the new language avoids gradients

// Real generated pages to showcase as social proof. Swap slugs for your best pages.
const SHOWCASE: { slug: string; name: string; tag: string }[] = [
  { slug: 'uqhvd7n', name: 'מאפיית לחם הבית', tag: 'מאפייה' },
  { slug: 'lhzvd6z', name: 'ידידים', tag: 'עמותה' },
];

// ─── Animated demo — the centerpiece ──────────────────────────────────────────
// Loops through: typing a business name → "building" → finished mini page.
function AnimatedDemo() {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState('');
  const fullName = 'מאפיית לחם הבית';

  // Drive the 0→1→2→0 loop.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setStep(1), 3200));
    timers.push(setTimeout(() => setStep(2), 5400));
    timers.push(setTimeout(() => { setStep(0); setTyped(''); }, 9800));
    return () => timers.forEach(clearTimeout);
  }, [step === 0]); // restart the cycle whenever we return to step 0

  // Typewriter for the business name during step 0.
  useEffect(() => {
    if (step !== 0) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTyped(fullName.slice(0, i));
      if (i >= fullName.length) clearInterval(id);
    }, 110);
    return () => clearInterval(id);
  }, [step]);

  return (
    <div className="relative w-full max-w-md mx-auto">
      {/* Browser mockup */}
      <div className="rounded-2xl overflow-hidden border-[10px] border-slate-900 shadow-2xl bg-white">
        <div className="bg-slate-900 h-7 flex items-center gap-2 px-3">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
          </div>
          <span className="flex-1 text-center text-slate-500 text-[11px] font-medium truncate">
            {step === 2 ? `${BRAND.toLowerCase()}.ai/p/מאפייה` : `${BRAND.toLowerCase()}.ai`}
          </span>
        </div>

        <div className="relative h-[340px] bg-white overflow-hidden">
          <AnimatePresence mode="wait">
            {/* STEP 0 — form / typing */}
            {step === 0 && (
              <motion.div key="form" dir="rtl"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 p-6 flex flex-col gap-4">
                <p className="text-sm font-bold text-slate-700">ספרו לנו על העסק</p>
                <div>
                  <label className="text-[11px] text-slate-400">שם העסק</label>
                  <div className="mt-1 rounded-lg border-2 px-3 py-2.5 text-sm font-semibold text-slate-800 min-h-[42px]" style={{ borderColor: PRIMARY, background: 'var(--shell)' }}>
                    {typed}<span className="inline-block w-0.5 h-4 align-middle animate-pulse" style={{ background: PRIMARY }} />
                  </div>
                </div>
                <div className="flex gap-2">
                  {['מאפייה', 'מסעדה', 'יופי'].map((c, i) => (
                    <span key={c} className={`px-3 py-1.5 rounded-full text-xs font-medium ${i === 0 ? 'text-white' : 'bg-slate-100 text-slate-500'}`}
                      style={i === 0 ? { background: GRAD } : undefined}>{c}</span>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-[11px] text-slate-400">צבע מותג</span>
                  {[PRIMARY, '#f59e0b', '#10b981'].map((c, i) => (
                    <span key={c} className="w-6 h-6 rounded-full border-2" style={{ background: c, borderColor: i === 0 ? '#1e293b' : 'transparent' }} />
                  ))}
                </div>
                <div className="mt-auto rounded-xl py-3 text-center text-sm font-bold text-white" style={{ background: GRAD }}>
                  צור את הדף שלי ✦
                </div>
              </motion.div>
            )}

            {/* STEP 1 — building */}
            {step === 1 && (
              <motion.div key="build" dir="rtl"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 p-6 flex flex-col items-center justify-center gap-5">
                <div className="relative flex items-center justify-center">
                  <span className="absolute w-16 h-16 rounded-full opacity-20 animate-ping" style={{ background: GRAD }} />
                  <span className="relative rounded-full p-3.5" style={{ background: GRAD }}>
                    <Wand2 size={24} className="text-white" />
                  </span>
                </div>
                <p className="text-sm font-semibold text-slate-700">בונה את הדף שלך…</p>
                <div className="w-full max-w-[200px] h-2 rounded-full bg-slate-100 overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ background: GRAD }}
                    initial={{ width: '10%' }} animate={{ width: '92%' }} transition={{ duration: 2, ease: 'easeOut' }} />
                </div>
                <div className="w-full space-y-2 opacity-60">
                  {[100, 80, 90].map((w, i) => (
                    <div key={i} className="h-2.5 rounded bg-slate-100 animate-pulse" style={{ width: `${w}%` }} />
                  ))}
                </div>
              </motion.div>
            )}

            {/* STEP 2 — finished mini page */}
            {step === 2 && (
              <motion.div key="done" dir="rtl"
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="absolute inset-0 overflow-hidden">
                {/* hero */}
                <div className="h-[150px] flex flex-col items-center justify-center text-center px-4 text-white" style={{ background: GRAD }}>
                  <p className="text-lg font-extrabold">מאפיית לחם הבית</p>
                  <p className="text-[11px] opacity-90 mt-1">לחם מחמצת טרי כל בוקר — אפוי במקום באהבה</p>
                  <span className="mt-2 px-4 py-1.5 rounded-full bg-white text-[11px] font-bold" style={{ color: PRIMARY }}>הזמינו עכשיו</span>
                </div>
                {/* cards */}
                <div className="p-4 grid grid-cols-3 gap-2">
                  {['מחמצת', 'מאפים', 'עוגות'].map((t) => (
                    <div key={t} className="rounded-lg border border-slate-100 p-2 flex flex-col items-center gap-1.5">
                      <div className="w-full h-10 rounded" style={{ background: `${PRIMARY}22` }} />
                      <span className="text-[10px] font-semibold text-slate-600">{t}</span>
                    </div>
                  ))}
                </div>
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3, type: 'spring' }}
                  className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white shadow-lg text-[11px] font-bold text-emerald-600">
                  <Check size={13} /> הדף מוכן!
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* floating badge */}
      <motion.div
        animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -bottom-4 -right-3 bg-white rounded-2xl shadow-xl border border-slate-100 px-4 py-2.5 flex items-center gap-2">
        <span className="rounded-full p-1.5" style={{ background: GRAD }}><Zap size={14} className="text-white" /></span>
        <span className="text-xs font-bold text-slate-700">פחות מ-60 שניות</span>
      </motion.div>
    </div>
  );
}

// ─── Small building blocks ────────────────────────────────────────────────────
function Section({ id, children, className = '' }: { id?: string; children: React.ReactNode; className?: string }) {
  return <section id={id} className={`relative z-10 px-6 ${className}`}><div className="max-w-6xl mx-auto">{children}</div></section>;
}

function FeatureCard({ icon, title, desc, dark = false }: { icon: React.ReactNode; title: string; desc: string; dark?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true }}
      whileHover={{ y: -4 }} transition={{ type: 'spring', stiffness: 90, damping: 16 }}
      className="rounded-2xl p-6"
      style={dark
        ? { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }
        : { background: '#fff', border: '1px solid #E2E8F5', boxShadow: '0 2px 10px rgba(14,33,72,0.05)' }}>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
        style={{ background: dark ? 'rgba(111,231,255,0.14)' : `${PRIMARY}15`, color: dark ? GLOW : PRIMARY }}>
        {icon}
      </div>
      <h3 className="font-bold mb-1.5" style={{ color: dark ? '#fff' : NAVY }}>{title}</h3>
      <p className="text-sm leading-relaxed" style={{ color: dark ? '#AEB9D6' : '#64748b' }}>{desc}</p>
    </motion.div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
      className="rounded-2xl bg-white border mb-3 overflow-hidden transition-colors"
      style={{ borderColor: open ? PRIMARY : '#E2E8F5', boxShadow: '0 2px 12px rgba(14,33,72,0.05)' }}>
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between gap-4 px-6 py-5 text-right">
        <span className="font-bold text-lg" style={{ color: NAVY }}>{q}</span>
        <span className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
          style={{ background: open ? PRIMARY : '#EEF1FB', color: open ? '#fff' : PRIMARY }}>
          <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden">
            <p className="px-6 pb-5 text-base leading-relaxed text-slate-500">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Robot-head-shaped frame — shell outline (rounded rect + side nubs + antenna),
// no face fill. Content goes inside. A signature brand container.
function HeadFrame({ children, filled = false, className = '' }: { children: React.ReactNode; filled?: boolean; className?: string }) {
  return (
    <div className={`relative h-full ${className}`} style={{ marginTop: 20 }}>
      <div style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', width: 2.5, height: 13, background: NAVY }} />
      <div className="glow-pulse" style={{ position: 'absolute', top: -25, left: '50%', transform: 'translateX(-50%)', width: 11, height: 11, borderRadius: '50%', background: GLOW, boxShadow: '0 0 10px #6FE7FF' }} />
      <div style={{ position: 'absolute', top: '50%', insetInlineStart: -5, transform: 'translateY(-50%)', width: 8, height: 26, borderRadius: 4, background: PRIMARY }} />
      <div style={{ position: 'absolute', top: '50%', insetInlineEnd: -5, transform: 'translateY(-50%)', width: 8, height: 26, borderRadius: 4, background: PRIMARY }} />
      <div className="h-full" style={{ border: `2.5px solid ${NAVY}`, borderRadius: 28, background: filled ? PRIMARY : '#fff', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

// Section transition — Lando peeks in the middle of a hairline.
function LandoDivider({ mood = 'default', text }: { mood?: LandoMood; text?: string }) {
  return (
    <motion.div className="relative z-10 max-w-3xl mx-auto px-6 py-12 flex flex-col items-center gap-3"
      initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.6 }}>
      <div className="w-full flex items-center gap-5">
        <motion.div className="flex-1 h-0.5 rounded-full origin-right" style={{ background: '#C6D2F2' }}
          variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 1.1 } } }} />
        <motion.div className="relative flex-shrink-0"
          variants={{ hidden: { scale: 0, y: 24 }, show: { scale: 1, y: 0, transition: { type: 'spring', stiffness: 90, damping: 15 } } }}>
          <div className="lando-ripple absolute rounded-full" style={{ inset: 0, border: '2px solid rgba(111,231,255,0.55)' }} />
          <div className="lando-ripple absolute rounded-full" style={{ inset: 0, border: '2px solid rgba(111,231,255,0.5)', animationDelay: '1.1s' }} />
          <div className="lando-ripple absolute rounded-full" style={{ inset: 0, border: '2px solid rgba(111,231,255,0.4)', animationDelay: '2.2s' }} />
          <div className="glow-pulse absolute rounded-full" style={{ inset: '-28%', background: 'radial-gradient(circle, rgba(111,231,255,0.5), transparent 68%)', filter: 'blur(16px)' }} />
          <div className="lando-hover relative"><LandoBot mood={mood} size={104} /></div>
        </motion.div>
        <motion.div className="flex-1 h-0.5 rounded-full origin-left" style={{ background: '#C6D2F2' }}
          variants={{ hidden: { scaleX: 0 }, show: { scaleX: 1, transition: { duration: 1.1 } } }} />
      </div>
      {text && (
        <motion.div className="bg-white border rounded-2xl px-4 py-2 text-sm font-bold shadow-md"
          style={{ borderColor: '#C6D2F2', color: NAVY }}
          variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { delay: 0.7, duration: 0.6 } } }}>
          {text}
        </motion.div>
      )}
    </motion.div>
  );
}

// Glow underline motif for section headings (the antenna light).
function GlowBar() {
  return <motion.div initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.9 }}
    className="w-12 h-1 rounded-full mx-auto mt-3" style={{ background: GLOW, boxShadow: '0 0 8px #6FE7FF' }} />;
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MarketingLanding() {
  const [scrolled, setScrolled] = useState(false);
  const [scrollMood, setScrollMood] = useState<LandoMood>('default');
  const heroRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
      const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 240;
      if (nearBottom) { setScrollMood('success'); return; }
      const centerY = window.scrollY + window.innerHeight / 2;
      const faq = document.getElementById('faq');
      if (faq && centerY >= faq.offsetTop) { setScrollMood('question'); return; }
      setScrollMood('default');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div dir="rtl" className="relative min-h-screen font-sans text-slate-800 overflow-x-hidden" style={{ background: 'var(--bg)' }}>

      {/* Decorative floating blobs — soft brand-colour depth behind the content */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="lando-blob absolute rounded-full" style={{ width: 380, height: 380, top: '-4%', insetInlineEnd: '-6%', background: 'rgba(46,99,246,0.16)', filter: 'blur(70px)' }} />
        <div className="lando-blob absolute rounded-full" style={{ width: 320, height: 320, top: '34%', insetInlineStart: '-8%', background: 'rgba(111,231,255,0.16)', filter: 'blur(80px)', animationDelay: '4s' }} />
        <div className="lando-blob absolute rounded-full" style={{ width: 300, height: 300, bottom: '12%', insetInlineEnd: '4%', background: 'rgba(124,92,252,0.13)', filter: 'blur(80px)', animationDelay: '8s' }} />
      </div>

      {/* Scroll companion — Lando reacts as you move down the page */}
      <div className={`fixed bottom-4 left-4 z-40 hidden lg:block pointer-events-none lando-hover ${scrolled ? 'opacity-100' : 'opacity-0'}`} style={{ transition: 'opacity .3s' }}>
        <LandoBot mood={scrollMood} size={64} />
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <header className={`fixed top-0 inset-x-0 z-50 transition ${scrolled ? 'bg-white/90 backdrop-blur border-b border-slate-100 shadow-sm' : ''}`}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LandoMark size={34} />
            <span className="font-extrabold text-lg" style={{ color: NAVY }}>{BRAND}</span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a href="#how" className="hover:text-[#2E63F6] transition">איך זה עובד</a>
            <a href="#examples" className="hover:text-[#2E63F6] transition">דוגמאות</a>
            <a href="#pricing" className="hover:text-[#2E63F6] transition">מחירים</a>
            <a href="#faq" className="hover:text-[#2E63F6] transition">שאלות</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-slate-600 hover:text-[#2E63F6] transition">התחברות</Link>
            <Link to="/create" className="rounded-xl px-4 py-2 text-sm font-bold text-white shadow-sm hover:opacity-90 transition" style={{ background: GRAD }}>
              צור דף חינם
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <Section className="pt-32 pb-20">
        <div ref={heroRef} className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="text-center lg:text-right">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold mb-6"
              style={{ background: 'var(--shell)', color: PRIMARY }}>
              <Sparkles size={13} /> מופעל על ידי בינה מלאכותית
            </motion.div>
            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              style={{ color: NAVY }}
              className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.1] tracking-tight">
              דף נחיתה מקצועי<br />
              <span style={{ background: GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                בפחות מ-60 שניות
              </span>
            </motion.h1>
            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="mt-6 text-lg text-slate-500 leading-relaxed max-w-lg mx-auto lg:mx-0">
              ספרו לנו על העסק — וה-AI כותב את התוכן, בוחר עיצוב, מייצר תמונות ובונה דף נחיתה שמוכן לפרסום. בלי מעצב, בלי מתכנת, בעברית.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link to="/create" className="rounded-xl px-7 py-3.5 text-base font-bold text-white shadow-lg hover:opacity-90 transition inline-flex items-center justify-center gap-2" style={{ background: GRAD }}>
                נסו עכשיו — בחינם <ArrowLeft size={18} />
              </Link>
              <a href="#how" className="rounded-xl px-7 py-3.5 text-base font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 transition inline-flex items-center justify-center gap-2">
                איך זה עובד
              </a>
            </motion.div>
            <p className="mt-4 text-xs text-slate-400">ניסיון חינם · ללא כרטיס אשראי · תשלום רק כשמפרסמים</p>
          </div>

          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}
            className="relative">
            <AnimatedDemo />
            <div className="absolute -bottom-8 -left-6 lando-hover pointer-events-none hidden sm:block">
              <LandoBot mood="default" size={120} />
            </div>
            <div className="absolute bottom-8 left-24 hidden sm:block">
              <div className="bg-white border rounded-2xl rounded-bl-sm px-3.5 py-2 text-xs font-bold shadow-md" style={{ borderColor: '#C6D2F2', color: NAVY }}>
                60 שניות זה כל מה שצריך ✦
              </div>
            </div>
          </motion.div>
        </div>
      </Section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <Section id="how" className="py-20 bg-[#EAEEF9]">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-extrabold">שלושה צעדים. זהו.</h2>
          <GlowBar />
          <p className="mt-3 text-slate-500">מרעיון לדף מפורסם — בלי שום ידע טכני.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { n: '1', icon: <MessageSquare size={22} />, t: 'ספרו על העסק', d: 'שם, תחום, וכמה מילים. אפשר גם להעלות לוגו ותמונות משלכם.' },
            { n: '2', icon: <Wand2 size={22} />, t: 'ה-AI בונה', d: 'תוכן משכנע, פלטת צבעים, תמונות ומבנה — הכל נבנה אוטומטית מולכם.' },
            { n: '3', icon: <Rocket size={22} />, t: 'ערכו ופרסמו', d: 'שינוי טקסט, צבעים ותמונות בקליק. מפרסמים — והדף באוויר עם כתובת משלו.' },
          ].map((s, i) => (
            <motion.div key={s.n} initial={{ opacity: 0, y: 26, scale: 0.95 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.2, type: 'spring', stiffness: 90, damping: 16 }}>
              <HeadFrame>
                <div className="p-7 text-center">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 mx-auto" style={{ background: `${PRIMARY}15`, color: PRIMARY }}>{s.icon}</div>
                  <div className="text-xs font-black mb-1" style={{ color: PRIMARY }}>שלב {s.n}</div>
                  <h3 className="font-bold text-lg mb-1.5" style={{ color: NAVY }}>{s.t}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{s.d}</p>
                </div>
              </HeadFrame>
            </motion.div>
          ))}
        </div>
      </Section>

      <LandoDivider mood="success" text="שלושה צעדים ואתם באוויר ✦" />

      {/* ── Features (dark band — depth + contrast) ──────────────────────── */}
      <Section className="py-6">
        <div className="rounded-[2.5rem] px-6 sm:px-12 py-16 relative overflow-hidden" style={{ background: NAVY }}>
          <div className="lando-blob absolute rounded-full" style={{ top: -60, insetInlineStart: -40, width: 220, height: 220, background: 'rgba(111,231,255,0.14)', filter: 'blur(55px)' }} />
          <div className="lando-blob absolute rounded-full" style={{ bottom: -50, insetInlineEnd: -30, width: 200, height: 200, background: 'rgba(46,99,246,0.25)', filter: 'blur(55px)', animationDelay: '5s' }} />
          <div className="text-center mb-14 relative">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white">כל מה שדף נחיתה צריך</h2>
            <GlowBar />
            <p className="mt-3" style={{ color: '#9FB0D9' }}>בנוי לעסקים קטנים בישראל — מהר, בעברית, ובמובייל.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 relative">
            <FeatureCard dark icon={<Zap size={20} />} title="מהיר באמת" desc="דף שלם ומוכן לפרסום בפחות מדקה. בלי לחכות למעצב או למתכנת." />
            <FeatureCard dark icon={<Sparkles size={20} />} title="תוכן שכותב עצמו" desc="כותרות, תיאורי שירותים וקריאות לפעולה — כתובים על ידי AI שמבין שיווק." />
            <FeatureCard dark icon={<Palette size={20} />} title="עיצוב מותאם" desc="פלטת צבעים ותמונות שנבחרות אוטומטית לפי תחום העסק והמותג שלכם." />
            <FeatureCard dark icon={<Smartphone size={20} />} title="מושלם במובייל" desc="כל דף נראה מצוין בנייד — שם רוב הלקוחות שלכם באמת נמצאים." />
            <FeatureCard dark icon={<MessageSquare size={20} />} title="לוכד לידים" desc="טופס יצירת קשר מובנה — הפניות נאספות ומחכות לכם באזור האישי." />
            <FeatureCard dark icon={<Globe size={20} />} title="באוויר בכתובת משלכם" desc="מפרסמים בקליק והדף עולה לרשת עם קישור לשיתוף בוואטסאפ וברשתות." />
          </div>
        </div>
      </Section>

      <LandoDivider mood="default" text="הנה דפים אמיתיים שנבנו כאן ↓" />

      {/* ── Examples ─────────────────────────────────────────────────────── */}
      <Section id="examples" className="py-20 bg-[#E3E8F6]">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-extrabold">דפים אמיתיים שנבנו במערכת</h2>
          <GlowBar />
          <p className="mt-3 text-slate-500">לחצו כדי לראות דוגמה חיה.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {SHOWCASE.map((p) => (
            <a key={p.slug} href={`/p/${p.slug}`} target="_blank" rel="noopener noreferrer" className="group block">
              <HeadFrame className="transition group-hover:-translate-y-1">
                <div className="h-36 flex items-center justify-center text-white" style={{ background: GRAD }}>
                  <span className="text-xl font-extrabold">{p.name}</span>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.tag}</p>
                  </div>
                  <span className="text-sm font-semibold text-[#2E63F6] group-hover:gap-2 inline-flex items-center gap-1 transition-all">
                    צפייה <ArrowLeft size={15} />
                  </span>
                </div>
              </HeadFrame>
            </a>
          ))}
        </div>
      </Section>

      <LandoDivider mood="request" text="מוכנים לבנות את שלכם? ↓" />

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <Section id="pricing" className="py-20 bg-[#D8DFF0]">
        <div className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-extrabold">מחיר פשוט והוגן</h2>
          <GlowBar />
          <p className="mt-3 text-slate-500">בונים בחינם. משלמים רק כשמפרסמים.</p>
        </div>
        <div className="max-w-md mx-auto">
          {/* Single product — the page. Credits are a post-creation add-on and live
              in the personal area, not on the marketing page. */}
          <div className="rounded-3xl border-2 p-8 shadow-lg bg-white" style={{ borderColor: PRIMARY }}>
            <h3 className="font-bold text-lg text-slate-800">דף נחיתה</h3>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold">249</span><span className="text-lg font-bold">₪</span>
              <span className="text-sm text-slate-400 mr-1">/ דף לשנה</span>
            </div>
            <ul className="mt-6 space-y-3 text-sm">
              {['בנייה ועריכה חופשית לפני תשלום', 'דף באוויר עם כתובת משלו לשנה', 'עריכות תוכן, צבעים ותמונות ב-AI', 'טופס לידים ואזור אישי', 'חידוש שנתי — 99 ₪ בלבד'].map((f) => (
                <li key={f} className="flex items-center gap-2.5"><span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: GLOW, boxShadow: '0 0 8px #6FE7FF' }} /><span className="text-slate-600">{f}</span></li>
              ))}
            </ul>
            <Link to="/create" className="mt-8 block text-center rounded-xl py-3.5 font-bold text-white shadow hover:opacity-90 transition" style={{ background: GRAD }}>
              התחילו לבנות — בחינם
            </Link>
            <p className="mt-4 text-center text-xs text-slate-400">קרדיטים לעריכות AI זמינים באזור האישי, אחרי שיצרתם דף.</p>
          </div>
        </div>
      </Section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <Section id="faq" className="py-20 bg-[#E7EBF7]">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-extrabold">שאלות נפוצות</h2>
          <GlowBar />
        </div>
        <div className="max-w-3xl mx-auto">
          <FaqItem q="באמת אפשר לבנות דף בלי שום ידע טכני?" a="כן. ממלאים כמה שדות על העסק, וה-AI עושה את כל השאר — תוכן, עיצוב ותמונות. אתם רק עורכים ומפרסמים." />
          <FaqItem q="צריך לשלם כדי לנסות?" a="לא. בונים ורואים את הדף בחינם. משלמים רק כשרוצים לפרסם אותו לאוויר." />
          <FaqItem q="אפשר לערוך את הדף אחרי שנבנה?" a="בהחלט. אפשר לשנות טקסטים, צבעים ותמונות ישירות על הדף, ואף לבקש מה-AI לכתוב מחדש קטעים." />
          <FaqItem q="הדף יעבוד טוב בנייד?" a="כן. כל דף נבנה מותאם למובייל אוטומטית — שם נמצאים רוב הלקוחות." />
          <FaqItem q="מה קורה עם פניות של לקוחות?" a="לכל דף יש טופס יצירת קשר. הפניות נאספות ומחכות לכם באזור האישי, עם אפשרות ייצוא לאקסל." />
        </div>
      </Section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <Section className="py-20">
        <div className="max-w-3xl mx-auto">
          <HeadFrame filled>
            <div className="p-12 sm:p-16 text-center text-white">
              <h2 className="text-3xl sm:text-4xl font-extrabold">הדף הבא של העסק שלכם<br />מחכה להיבנות</h2>
              <p className="mt-4 text-white/90">נסו עכשיו — בונים בחינם, משלמים רק כשמפרסמים.</p>
              <Link to="/create" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-extrabold shadow-lg hover:scale-105 transition" style={{ color: PRIMARY }}>
                צור דף נחיתה עכשיו <ArrowLeft size={18} />
              </Link>
            </div>
          </HeadFrame>
        </div>
      </Section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-slate-100 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <LandoMark size={26} />
            <span className="font-bold">{BRAND}</span>
          </div>
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} {BRAND} · דפי נחיתה מבוססי AI לעסקים בישראל</p>
          <div className="flex items-center gap-5 text-sm text-slate-500">
            <Link to="/create" className="hover:text-[#2E63F6] transition">צור דף</Link>
            <Link to="/login" className="hover:text-[#2E63F6] transition">התחברות</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
