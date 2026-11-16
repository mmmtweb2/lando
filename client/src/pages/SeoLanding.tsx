import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { motion, useReducedMotion } from 'framer-motion';
import { ListChecks, Users, Bot, ShieldCheck, MessageCircle, ChevronDown, Check, ArrowLeft, Search } from 'lucide-react';
import { getPublicConfig } from '../lib/publicConfig';
import { trackEvent } from '../lib/track';

// /seo — public marketing page for the Google business-card check (task #15, spec by David,
// marketing #14 with Avi's corrections). Content rules, all deliberate:
//  - the subscription and its price are stated (250/month or 2,500/year incl. VAT, landing page included);
//  - no testimonials, no ranking promise, no guarantee ("קידום הוגן"); copy in plural second person;
//  - no jargon in visible copy (no "SEO" / "profile" / "GBP"), no Google logo;
//  - "your data stays yours" only — an export is NOT promised until it exists;
//  - the example card is labelled as an illustration, never presented as a real business.
// Measurement: events go to window.dataLayer through lib/track (GTM itself loads only after consent,
// see lib/gtm.ts). Premium wording ("we update") is subject to Moshe's legal review before launch.

const NAVY = '#0E2148';
const BLUE = '#2E63F6';
const CYAN = '#6FE7FF';

const FAQ: { id: string; q: string; a: string; more: string }[] = [
  { id: 'price', q: 'כמה זה עולה?', a: 'הבדיקה חינמית. המנוי: ₪250 לחודש או ₪2,500 לשנה, כולל מע"מ.', more: 'המנוי החודשי מתחדש כל חודש עד שמבטלים, מהאזור האישי. המנוי השנתי הוא תשלום אחד ולא מתחדש מעצמו. דף הנחיתה של העסק כלול בשניהם.' },
  { id: 'time', q: 'כמה זמן לוקחת הבדיקה?', a: 'דקה.', more: 'כותבים שם עסק ועיר ומקבלים תוצאה.' },
  { id: 'website', q: 'צריך אתר?', a: 'לא.', more: 'כרטיס העסק בגוגל לא תלוי באתר. דף נחיתה לעסק כלול במנוי.' },
  { id: 'nocard', q: 'אין לנו כרטיס עסק בגוגל, מה עושים?', a: 'מתחילים ביצירה שלו.', more: 'יש הדרכה צעד-צעד ליצירה ולאימות, ואפשר להמשיך בהכנות בזמן שמחכים לאישור של גוגל.' },
  { id: 'rank', q: 'תבטיחו מקום ראשון בגוגל?', a: 'לא.', more: 'אף אחד לא יכול להבטיח את זה, ואנחנו לא מבטיחים. אנחנו דואגים שהכרטיס יהיה מלא, פעיל ועונה ללקוחות.' },
  { id: 'reviews', q: 'אתם כותבים ביקורות בשמנו?', a: 'לא.', more: 'את הביקורת הלקוח כותב בעצמו, ואנחנו עוזרים לכם לבקש אותה בלחיצה מהוואטסאפ. אנחנו כן עונים לביקורות בשמכם: לביקורת של 4-5 כוכבים התשובה מתפרסמת לבד, ולביקורת של 1-3 כוכבים אנחנו מכינים טיוטה שמחכה לאישור שלכם.' },
  { id: 'auto', q: 'מה מתפרסם בכרטיס בלי שנאשר?', a: 'פוסט שבועי ותשובות לביקורות טובות.', more: 'כל פוסט מחכה 48 שעות שבהן אפשר לקרוא, לערוך או לעצור אותו, ולא מתפרסם בשבת ובלילה. אפשר לעבור לאישור ידני של כל פוסט ותשובה, או לכבות, מתי שרוצים.' },
  { id: 'data', q: 'המידע שלנו נשאר שלנו?', a: 'כן.', more: 'המידע של העסק נשאר שלכם, ואפשר לנתק את החיבור לגוגל בכל רגע.' },
  { id: 'busy', q: 'אין לנו זמן ואנחנו לא טכנולוגיים. מתאים?', a: 'כן.', more: 'אחרי חיבור הכרטיס ואישור אחד של פרטי העסק, אנחנו עושים את העבודה השוטפת. אם נתקעתם, אפשר לכתוב לנו בוואטסאפ.' },
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
      בדקו את העסק שלכם בחינם <ArrowLeft size={18} aria-hidden />
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
          <p className="font-bold" style={{ color: NAVY }}>הכרטיס מוכן ב-62 מתוך 100</p>
          <p className="text-sm text-slate-500">ככה נראית התוצאה: ציון, ורשימה של מה לתקן קודם.</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2 text-sm text-slate-700">
        {['להוסיף שעות פעילות', 'להוסיף תמונות של העסק', 'לבקש ביקורות מהלקוחות'].map(t => (
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
    ? `https://wa.me/${concierge}?text=${encodeURIComponent('היי, אשמח לשמוע על המנוי לקידום העסק שלי בגוגל.')}`
    : null;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: `${f.a} ${f.more}` } })),
  };

  return (
    <div dir="rtl" className="min-h-screen bg-white font-sans text-slate-800">
      <Helmet>
        <title>קידום העסק בגוגל: בדיקה חינמית ומנוי | Pagey</title>
        <meta name="description" content="בדקו בחינם, בדקה, מה חסר בכרטיס העסק שלכם בגוגל. במנוי אנחנו מפרסמים פוסט כל שבוע, עונים לביקורות ושולחים דוח חודשי. בלי הבטחת דירוג." />
        <link rel="canonical" href="https://pagey.co.il/seo" />
        <script type="application/ld+json">{JSON.stringify(ld)}</script>
      </Helmet>

      {/* 1. Hero */}
      <header className="relative overflow-hidden px-5 pb-16 pt-14 text-center sm:pt-20" style={{ background: `linear-gradient(160deg, ${NAVY} 0%, #1A3A8A 100%)` }}>
        <div aria-hidden className="pointer-events-none absolute -top-24 right-[-6rem] h-72 w-72 rounded-full opacity-25 blur-3xl" style={{ backgroundColor: CYAN }} />
        <motion.div className="relative mx-auto max-w-3xl" initial={reduce ? false : { opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <h1 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">כשמחפשים אתכם בגוגל, מה אנשים רואים?</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-blue-100 sm:text-xl">
            בדקו בחינם, בדקה, מה חסר בכרטיס העסק שלכם ואיך הוא מוגדר לעומת עסקים דומים באזור. במנוי, אנחנו מטפלים בכרטיס בשבילכם כל שבוע.
          </p>
          <div className="mt-8"><AuditCta location="hero" /></div>
          <p className="mt-3 text-sm text-blue-200">הבדיקה חינמית ולוקחת דקה.</p>
          <ExampleCard />
        </motion.div>
      </header>

      <main>
        {/* 2. What the check gives */}
        <Section id="check" title="מה הבדיקה נותנת" lead="הבדיקה מראה, בדקה, מה חסר בכרטיס העסק שלכם בגוגל ומה כדאי לתקן קודם.">
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              { Icon: ListChecks, t: 'מה חסר', d: 'רשימה לפי חשיבות, עם הסבר למה זה חשוב ואיך מתקנים.' },
              { Icon: Users, t: 'איפה אתם מול המתחרים', d: 'השוואה לעסקים דומים באזור שלכם.' },
              { Icon: Bot, t: 'מוכן גם לתשובות AI?', d: 'בדיקה אם הפרטים שלכם כתובים כך שגוגל וצ\'אטים יוכלו לקרוא אותם.' },
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
        <Section id="how" tint title="איך זה עובד" lead="שלושה צעדים, ואחר כך אנחנו עובדים בשבילכם.">
          <ol className="mt-8 space-y-4">
            {[
              { n: 1, who: 'אתם', t: 'בודקים את העסק בחינם ומקבלים רשימה ברורה של מה לתקן.' },
              { n: 2, who: 'אתם', t: 'נרשמים למנוי, מחברים את כרטיס העסק בגוגל ומאשרים פעם אחת את פרטי העסק.' },
              { n: 3, who: 'אנחנו', t: 'כל שבוע פוסט חדש בכרטיס, תשובות לביקורות, דף נחיתה ודוח חודשי שמראה מה עשינו ואיך הגיעו הפניות.' },
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
              'בלי ביקורות מזויפות: את הביקורת הלקוח כותב בעצמו. אנחנו עוזרים לבקש אותה מכל לקוח, ועונים לביקורות בשמכם לפי ההגדרות שבחרתם.',
              'בלי מאות דפים גנריים ובלי קניית קישורים.',
              'כל מה שמתפרסם בשמכם מבוסס רק על פרטי העסק שאישרתם, ואפשר לעצור כל דבר.',
              'המידע של העסק נשאר שלכם.',
            ].map(t => (
              <li key={t} className="flex items-start gap-3 text-slate-700"><ShieldCheck size={20} className="mt-0.5 flex-shrink-0 text-emerald-600" aria-hidden />{t}</li>
            ))}
          </ul>
        </Section>

        {/* 5. The free check, then the subscription */}
        <section id="plans" ref={plansRef} className="px-5 py-16 sm:py-20" style={{ backgroundColor: '#F3F6FD' }}>
          <div className="mx-auto max-w-4xl">
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl" style={{ color: NAVY }}>מתחילים בבדיקה חינמית, ממשיכים במנוי שעובד בשבילכם</h2>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <article className="flex flex-col rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
                <h3 className="text-xl font-black" style={{ color: NAVY }}>בדיקה חינמית</h3>
                <p className="mt-2 font-semibold text-slate-700">מה חסר בכרטיס, ומה לתקן קודם.</p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
                  {['ציון מוכנות לכרטיס העסק', 'השוואה לעסקים דומים באזור', 'בדיקת מוכנות לתשובות AI', 'רשימת תיקונים לפי חשיבות'].map(t => (
                    <li key={t} className="flex items-center gap-2"><Check size={15} className="text-emerald-600" aria-hidden />{t}</li>
                  ))}
                </ul>
                <Link to={auditHref('plans')} onClick={() => { trackEvent('seo_plan_click', { plan: 'basic' }); trackEvent('seo_cta_audit_click', { location: 'plans' }); }}
                  className="mt-6 inline-flex items-center justify-center rounded-full px-6 py-3 font-extrabold text-white transition hover:opacity-90" style={{ backgroundColor: BLUE }}>
                  להתחיל בבדיקה חינמית
                </Link>
              </article>
              <article className="flex flex-col rounded-3xl p-6 text-white shadow-lg" style={{ background: `linear-gradient(160deg, ${NAVY}, #1A3A8A)` }}>
                <h3 className="text-xl font-black">מנוי קידום העסק בגוגל</h3>
                <p className="mt-2 text-2xl font-black">₪250 לחודש <span className="block text-sm font-semibold text-blue-200 sm:inline">או ₪2,500 לשנה, כולל מע"מ</span></p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-blue-100">
                  {['כל שבוע אנחנו כותבים ומפרסמים פוסט בכרטיס העסק', 'עונים לביקורות טובות; לביקורת שלילית מכינים טיוטה לאישורכם', 'דף נחיתה לעסק ודפים לחיפושים באזור שלכם', 'דוח חודשי: מה עשינו ואיך הגיעו הפניות', 'ערכה לבקשת ביקורות מהלקוחות'].map(t => (
                    <li key={t} className="flex items-start gap-2"><Check size={15} className="mt-0.5 flex-shrink-0 text-emerald-300" aria-hidden />{t}</li>
                  ))}
                </ul>
                <p className="mt-4 text-xs leading-relaxed text-blue-200">חודשי: מתחדש כל חודש עד שמבטלים. שנתי: תשלום אחד, לא מתחדש מעצמו. בלי הבטחת דירוג.</p>
                <Link to="/seo-plan" onClick={() => trackEvent('seo_plan_click', { plan: 'subscription' })}
                  className="mt-5 inline-flex items-center justify-center rounded-full bg-white px-6 py-3 font-extrabold transition hover:bg-blue-50" style={{ color: NAVY }}>
                  לפרטי המנוי
                </Link>
                {conciergeHref && (
                  <a href={conciergeHref} target="_blank" rel="noopener noreferrer"
                    onClick={() => { trackEvent('seo_plan_click', { plan: 'premium' }); trackEvent('Concierge_Clicked', { location: 'seo' }); }}
                    className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 text-sm font-bold text-blue-100 underline-offset-4 hover:underline">
                    <MessageCircle size={16} aria-hidden /> שאלות? דברו איתנו בוואטסאפ
                  </a>
                )}
              </article>
            </div>
          </div>
        </section>

        {/* 6. AI answers */}
        <Section id="ai" title="מוכן גם לתשובות AI" lead="גוגל וצ'אטים של AI קוראים מידע שכתוב בצורה ברורה: שירותים, אזורי שירות, מחירים ושאלות נפוצות.">
          <p className="mt-4 text-slate-600">הבדיקה מראה אם המידע שלכם כתוב כך, ומה להוסיף. אנחנו לא יכולים להבטיח שתופיעו בתשובה, אבל אפשר להיות מוכנים.</p>
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
          <h2 className="text-2xl font-black text-white sm:text-3xl">רוצים לראות מה רואים כשמחפשים אתכם?</h2>
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
