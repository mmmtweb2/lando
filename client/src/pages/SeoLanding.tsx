import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { motion, useReducedMotion } from 'framer-motion';
import { ListChecks, Users, Bot, ShieldCheck, MessageCircle, ChevronDown, Check, ArrowLeft, Search } from 'lucide-react';
import { getPublicConfig } from '../lib/publicConfig';
import { trackEvent } from '../lib/track';

// /seo — public marketing page for the Google business-card check (task #15, spec by David,
// marketing #14 with Avi's corrections). Content rules, all deliberate:
//  - no price, no testimonials, no ranking promise, no guarantee, no "automatic update in Google";
//  - no jargon in visible copy (no "SEO" / "profile" / "GBP"), no Google logo;
//  - "your data stays yours" only — an export is NOT promised until it exists;
//  - the example card is labelled as an illustration, never presented as a real business.
// Measurement: events go to window.dataLayer through lib/track (GTM itself loads only after consent,
// see lib/gtm.ts). Premium wording ("we update") is subject to Moshe's legal review before launch.

const NAVY = '#0E2148';
const BLUE = '#2E63F6';
const CYAN = '#6FE7FF';

const FAQ: { id: string; q: string; a: string; more: string }[] = [
  { id: 'price', q: 'כמה זה עולה?', a: 'הבדיקה חינמית.', more: 'אנחנו בשלב פיילוט והמחירים עוד לא פורסמו.' },
  { id: 'time', q: 'כמה זמן לוקחת הבדיקה?', a: 'דקה.', more: 'כותבים שם עסק ועיר ומקבלים תוצאה.' },
  { id: 'website', q: 'אני צריך אתר?', a: 'לא.', more: 'כרטיס העסק בגוגל לא תלוי באתר. למי שאין אתר אפשר להוסיף דף נחיתה דרך Pagey.' },
  { id: 'nocard', q: 'אין לי כרטיס עסק בגוגל, מה עושים?', a: 'מתחילים ביצירה שלו.', more: 'יש הדרכה צעד-צעד ליצירה ולאימות, ואפשר להמשיך בהכנות בזמן שמחכים לאישור של גוגל.' },
  { id: 'rank', q: 'תבטיחו שאגיע למקום הראשון?', a: 'לא.', more: 'אף אחד לא יכול להבטיח את זה, ואנחנו לא מבטיחים. אנחנו עוזרים לך לסדר את מה שבשליטתך.' },
  { id: 'reviews', q: 'אתם כותבים ביקורות בשמי?', a: 'לא.', more: 'את הביקורת הלקוח כותב בעצמו. אנחנו עוזרים לבקש אותה בלחיצה מהוואטסאפ שלך, ובקרוב נכין גם טיוטת תשובה לביקורות שלא נענו. אתה מאשר לפני כל שליחה.' },
  { id: 'data', q: 'המידע שלי נשאר שלי?', a: 'כן.', more: 'המידע שלך נשאר שלך.' },
  { id: 'busy', q: 'אני לא טכנולוגי ואין לי זמן. מתאים לי?', a: 'כן.', more: 'ההקמה מודרכת בצעדים קצרים, אפשר לעצור ולהמשיך, ואם נתקעת אפשר לכתוב לנו בוואטסאפ. במסלול פרימיום אנחנו עושים בשבילך.' },
];

function utmParams(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    new URLSearchParams(window.location.search).forEach((v, k) => { if (k.startsWith('utm_')) out[k] = v.slice(0, 80); });
  } catch { /* ignore */ }
  return out;
}

function auditHref(location: string) {
  return `/audit?utm_source=seo_page&utm_medium=cta&utm_campaign=${location}`;
}

function AuditCta({ location, className = '' }: { location: 'hero' | 'plans' | 'footer'; className?: string }) {
  return (
    <Link
      to={auditHref(location)}
      onClick={() => trackEvent('seo_cta_audit_click', { location })}
      className={`inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-base font-extrabold text-white shadow-lg shadow-blue-600/25 transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300 ${className}`}
      style={{ backgroundColor: BLUE }}
    >
      בדוק את העסק שלך בחינם <ArrowLeft size={18} aria-hidden />
    </Link>
  );
}

function Section({ id, title, lead, children, tint }: { id?: string; title: string; lead: string; children?: React.ReactNode; tint?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <section id={id} className="px-5 py-16 sm:py-20" style={{ backgroundColor: tint ? '#F3F6FD' : '#ffffff' }}>
      <motion.div
        className="mx-auto max-w-3xl"
        initial={reduce ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="text-2xl font-black tracking-tight sm:text-3xl" style={{ color: NAVY }}>{title}</h2>
        <p className="mt-3 text-lg leading-relaxed text-slate-600">{lead}</p>
        {children}
      </motion.div>
    </section>
  );
}

function ExampleCard() {
  return (
    <div className="mx-auto mt-10 w-full max-w-sm rounded-3xl bg-white p-5 text-right shadow-xl ring-1 ring-slate-200" aria-label="דוגמה להמחשה">
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">דוגמה להמחשה בלבד</span>
        <span className="text-xs text-slate-400">לא עסק אמיתי</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-black text-white" style={{ background: `conic-gradient(${BLUE} 0 62%, #E0E6F4 62% 100%)` }}>
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white" style={{ color: NAVY }}>62</span>
        </div>
        <div>
          <p className="font-bold" style={{ color: NAVY }}>הכרטיס שלך מוכן ב-62 מתוך 100</p>
          <p className="text-sm text-slate-500">ככה נראית התוצאה: ציון, ורשימה של מה לתקן קודם.</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2 text-sm text-slate-700">
        {['להוסיף שעות פעילות', 'להוסיף תמונות של העסק', 'לבקש ביקורות מלקוחות מרוצים'].map(t => (
          <li key={t} className="flex items-center gap-2"><Check size={15} className="text-emerald-600" aria-hidden />{t}</li>
        ))}
      </ul>
    </div>
  );
}

export default function SeoLanding() {
  const reduce = useReducedMotion();
  const [concierge, setConcierge] = useState<string | null>(null);
  const plansRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let alive = true;
    getPublicConfig().then(c => { if (alive) setConcierge(c?.concierge ?? null); });
    return () => { alive = false; };
  }, []);

  // page view + scroll depth (each fires once)
  useEffect(() => {
    trackEvent('seo_page_view', utmParams());
    const fired = { 50: false, 90: false };
    const onScroll = () => {
      const h = document.documentElement;
      const pct = ((h.scrollTop + window.innerHeight) / Math.max(1, h.scrollHeight)) * 100;
      ([50, 90] as const).forEach(p => { if (!fired[p] && pct >= p) { fired[p] = true; trackEvent(`seo_scroll_${p}`); } });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // plans section seen
  useEffect(() => {
    const el = plansRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { trackEvent('seo_plans_view'); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const conciergeHref = concierge
    ? `https://wa.me/${concierge}?text=${encodeURIComponent('היי, אשמח לשמוע על מסלול פרימיום לקידום העסק שלי בגוגל.')}`
    : null;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: `${f.a} ${f.more}` } })),
  };

  return (
    <div dir="rtl" className="min-h-screen bg-white font-sans text-slate-800">
      <Helmet>
        <title>בדיקה חינמית לכרטיס העסק שלך בגוגל | Pagey</title>
        <meta name="description" content="בדוק בחינם, בדקה, מה חסר בכרטיס העסק שלך בגוגל ואיך הוא מוגדר לעומת עסקים דומים באזור. בלי הבטחות ובלי חבילות מנופחות." />
        <link rel="canonical" href="https://pagey.co.il/seo" />
        <script type="application/ld+json">{JSON.stringify(ld)}</script>
      </Helmet>

      {/* 1. Hero */}
      <header className="relative overflow-hidden px-5 pb-16 pt-14 text-center sm:pt-20" style={{ background: `linear-gradient(160deg, ${NAVY} 0%, #1A3A8A 100%)` }}>
        <div aria-hidden className="pointer-events-none absolute -top-24 right-[-6rem] h-72 w-72 rounded-full opacity-25 blur-3xl" style={{ backgroundColor: CYAN }} />
        <motion.div className="relative mx-auto max-w-3xl" initial={reduce ? false : { opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <h1 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">כשמחפשים אותך בגוגל, מה אנשים רואים?</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-blue-100 sm:text-xl">
            בדוק בחינם, בדקה, מה חסר בכרטיס העסק שלך, ואיך הוא מוגדר לעומת עסקים דומים באזור.
          </p>
          <div className="mt-8"><AuditCta location="hero" /></div>
          <p className="mt-3 text-sm text-blue-200">הבדיקה חינמית ולוקחת דקה.</p>
          <ExampleCard />
        </motion.div>
      </header>

      <main>
        {/* 2. What the check gives */}
        <Section id="check" title="מה הבדיקה נותנת" lead="הבדיקה אומרת לך, בדקה, מה חסר בכרטיס העסק שלך בגוגל ומה כדאי לתקן קודם.">
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { Icon: ListChecks, t: 'מה חסר', d: 'רשימה לפי חשיבות, עם הסבר למה זה חשוב ואיך מתקנים.' },
              { Icon: Users, t: 'איפה אתה מול המתחרים', d: 'השוואה לעסקים דומים באזור שלך.' },
              { Icon: Bot, t: 'מוכן גם לתשובות AI?', d: 'בדיקה אם הפרטים שלך כתובים כך שגוגל וצ\'אטים יוכלו לקרוא אותם.' },
            ].map(({ Icon, t, d }) => (
              <li key={t} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl text-white" style={{ backgroundColor: BLUE }}><Icon size={22} aria-hidden /></span>
                <h3 className="font-extrabold" style={{ color: NAVY }}>{t}</h3>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{d}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* 3. How it works */}
        <Section id="how" tint title="איך זה עובד" lead="שלושה צעדים, ואתה שולט בכל אחד מהם.">
          <ol className="mt-8 space-y-4">
            {[
              { n: 1, who: 'אתה', t: 'כותבים שם עסק ועיר.' },
              { n: 2, who: 'אנחנו', t: 'מקבלים רשימה ברורה של מה לתקן, לפי חשיבות.' },
              { n: 3, who: 'אתה, או אנחנו במסלול פרימיום', t: 'מתקנים לבד עם הדרכה צעד-צעד, או מעבירים לנו.' },
            ].map(s => (
              <li key={s.n} className="flex items-start gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-lg font-black text-white" style={{ backgroundColor: NAVY }}>{s.n}</span>
                <div>
                  <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold" style={{ color: BLUE }}>{s.who}</span>
                  <p className="mt-1.5 text-slate-700">{s.t}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        {/* 4. Fair promotion */}
        <Section id="fair" title="קידום הוגן" lead="אנחנו לא מבטיחים מקום ראשון בגוגל, כי אי אפשר להבטיח את זה.">
          <ul className="mt-6 space-y-3">
            {[
              'בלי הבטחת דירוג.',
              'בלי ביקורות מזויפות: את הביקורת הלקוח שלך כותב בעצמו. אנחנו רק עוזרים לבקש אותה בלחיצה מהוואטסאפ שלך.',
              'בלי מאות דפים גנריים ובלי קניית קישורים.',
              'המידע שלך נשאר שלך.',
              'פשוט עד כדי כך שבעל עסק לא-טכנולוגי יכול לבד.',
            ].map(t => (
              <li key={t} className="flex items-start gap-3 text-slate-700"><ShieldCheck size={20} className="mt-0.5 flex-shrink-0 text-emerald-600" aria-hidden />{t}</li>
            ))}
          </ul>
        </Section>

        {/* 5. Two plans, no price */}
        <section id="plans" ref={plansRef} className="px-5 py-16 sm:py-20" style={{ backgroundColor: '#F3F6FD' }}>
          <div className="mx-auto max-w-4xl">
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl" style={{ color: NAVY }}>שני מסלולים, לפי כמה אתה רוצה לעשות בעצמך</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <article className="flex flex-col rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <h3 className="text-xl font-black" style={{ color: NAVY }}>בסיסי</h3>
                <p className="mt-2 font-semibold text-slate-700">אנחנו בודקים, מכינים ומדריכים. אתה מבצע ומאשר.</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
                  {['בדיקה חינמית', 'בדיקת מוכנות לתשובות AI', 'השוואה למתחרים', 'בקשת ביקורת בלחיצה מהוואטסאפ', 'טיוטת תשובה לביקורת (בקרוב)', 'תוכן מוכן להעתקה', 'דוח חודשי (בקרוב)', 'עזרה בוואטסאפ'].map(t => (
                    <li key={t} className="flex items-center gap-2"><Check size={15} className="text-emerald-600" aria-hidden />{t}</li>
                  ))}
                </ul>
                <Link to={auditHref('plans')} onClick={() => { trackEvent('seo_plan_click', { plan: 'basic' }); trackEvent('seo_cta_audit_click', { location: 'plans' }); }}
                  className="mt-6 inline-flex items-center justify-center rounded-full px-6 py-3 font-extrabold text-white transition hover:opacity-90" style={{ backgroundColor: BLUE }}>
                  התחל בבדיקה חינמית
                </Link>
              </article>
              <article className="flex flex-col rounded-3xl p-6 text-white shadow-lg" style={{ background: `linear-gradient(160deg, ${NAVY}, #1A3A8A)` }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black">פרימיום</h3>
                  <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">מקומות מוגבלים בפיילוט, בהרשמה אישית</span>
                </div>
                <p className="mt-2 font-semibold text-blue-100">אנחנו עושים בשבילך את ההקמה, העדכונים והתשובות לביקורות, בליווי אישי. אתה נותן פרטים ותמונות ומאשר דברים רגישים.</p>
                <p className="mt-4 flex-1 text-sm text-blue-200">בשני המסלולים: בלי הבטחת דירוג, בלי כתיבת ביקורות בשם הלקוח, והמידע נשאר שלך.</p>
                {conciergeHref && (
                  <a href={conciergeHref} target="_blank" rel="noopener noreferrer"
                    onClick={() => { trackEvent('seo_plan_click', { plan: 'premium' }); trackEvent('Concierge_Clicked', { location: 'seo' }); }}
                    className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 font-extrabold transition hover:bg-blue-50" style={{ color: NAVY }}>
                    <MessageCircle size={18} aria-hidden /> דבר איתנו בוואטסאפ
                  </a>
                )}
              </article>
            </div>
          </div>
        </section>

        {/* 6. AI answers */}
        <Section id="ai" title="מוכן גם לתשובות AI" lead="גוגל וצ'אטים של AI קוראים מידע שכתוב בצורה ברורה: שירותים, אזורי שירות, מחירים ושאלות נפוצות.">
          <p className="mt-4 text-slate-600">הבדיקה מראה אם המידע שלך כתוב כך, ומה להוסיף. אנחנו לא יכולים להבטיח שתופיע בתשובה, אבל אפשר להיות מוכן.</p>
        </Section>

        {/* 7. FAQ — answer first, then the short explanation; native <details> so it works without JS */}
        <Section id="faq" tint title="שאלות נפוצות" lead="תשובה קודם, ואז הסבר קצר.">
          <div className="mt-6 divide-y divide-slate-200 rounded-2xl bg-white ring-1 ring-slate-200">
            {FAQ.map(f => (
              <details key={f.id} className="group px-5 py-4" onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) trackEvent('seo_faq_open', { question_id: f.id }); }}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300" style={{ color: NAVY }}>
                  <span>{f.q}</span>
                  <ChevronDown size={18} className="flex-shrink-0 transition group-open:rotate-180" aria-hidden />
                </summary>
                <p className="mt-3 leading-relaxed text-slate-600"><strong className="text-slate-800">{f.a}</strong> {f.more}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* 8. Closing CTA */}
        <section className="px-5 py-16 text-center sm:py-20" style={{ backgroundColor: NAVY }}>
          <h2 className="text-2xl font-black text-white sm:text-3xl">מוכן לראות מה רואים כשמחפשים אותך?</h2>
          <div className="mt-7"><AuditCta location="footer" /></div>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-blue-200"><Search size={14} aria-hidden /> בחינם, בדקה, בלי הרשמה.</p>
        </section>
      </main>

      <footer className="px-5 py-8 text-center text-xs text-slate-500">
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link to="/" className="inline-flex min-h-[44px] items-center px-1 hover:underline">Pagey</Link>
          <Link to="/privacy" className="inline-flex min-h-[44px] items-center px-1 hover:underline">מדיניות פרטיות</Link>
          <Link to="/terms" className="inline-flex min-h-[44px] items-center px-1 hover:underline">תנאי שימוש</Link>
          <Link to="/accessibility" className="inline-flex min-h-[44px] items-center px-1 hover:underline">הצהרת נגישות</Link>
        </nav>
      </footer>
    </div>
  );
}
