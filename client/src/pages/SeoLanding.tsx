import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft, Check, ChevronDown, Clock, Globe, Image as ImageIcon, MapPin, MessageCircle, Moon, Phone,
  PenLine, Search, ShieldCheck, Star, CalendarDays, FileText, ListChecks, Navigation,
} from 'lucide-react';
import { getPublicConfig } from '../lib/publicConfig';
import { trackEvent } from '../lib/track';

// /seo: the public sales page of the Google-promotion subscription (v2, 17.11.2026, README part 134).
// Content rules, all deliberate (marketing spec + legal audit 16.11):
//  - the subscription and its price are stated (250/month or 2,500/year incl. VAT, landing page included);
//  - no testimonials and no number presented as real: every number on this page sits inside an element
//    labelled "המחשה" (illustration); no ranking promise, no superlatives ("קידום הוגן");
//  - plural second person; no jargon in visible copy (no "SEO" / "profile" / "GBP"), no Google logo;
//  - "your data stays yours" only; an export is NOT promised until it exists;
//  - what the page says the product does matches the code: 48 hours to edit a post, never on Shabbat or at
//    night, 4-5 star reviews answered automatically, 1-3 star reviews drafted for approval, the listing
//    editable from the dashboard (docs/gbp-sync-spec.md).
// Motion: one orchestrated moment only (the hero illustration assembling), nothing on scroll; reduced
// motion shows everything at once. Measurement goes through lib/track (GTM loads only after consent).

const NAVY = '#0E2148';
const BLUE = '#2E63F6';
const CYAN = '#6FE7FF';
const PAPER = '#F4F7FC';
const LEAF = '#0E7A55';

const PRICE = { month: 250, year: 2500 } as const;

const FAQ: { id: string; q: string; a: string; more: string }[] = [
  { id: 'price', q: 'כמה זה עולה?', a: '₪250 לחודש או ₪2,500 לשנה, כולל מע"מ.', more: 'המנוי החודשי מתחדש כל חודש עד שמבטלים, מהאזור האישי. המנוי השנתי הוא תשלום אחד ולא מתחדש מעצמו. דף הנחיתה של העסק כלול בשניהם. הבדיקה של הכרטיס חינמית.' },
  { id: 'auto', q: 'מה מתפרסם בכרטיס בלי שנאשר?', a: 'פוסט שבועי ותשובות לביקורות טובות.', more: 'כל פוסט מחכה 48 שעות שבהן אפשר לקרוא, לערוך או לעצור אותו, ולא מתפרסם בשבת ובלילה. אפשר לעבור לאישור ידני של כל פוסט ותשובה, או לכבות, מתי שרוצים.' },
  { id: 'edit', q: 'אפשר לשנות בעצמנו פרטים בכרטיס?', a: 'כן, מהאזור האישי.', more: 'אתר, טלפונים, שעות פעילות, חגים וימים מיוחדים, תיאור, שירותים ותמונות. השינוי עובר לכרטיס בגוגל, ולפעמים גוגל בודקת אותו כמה ימים לפני שהוא מופיע.' },
  { id: 'reviews', q: 'אתם כותבים ביקורות בשמנו?', a: 'לא.', more: 'את הביקורת הלקוח כותב בעצמו, ואנחנו עוזרים לכם לבקש אותה בלחיצה מהוואטסאפ. אנחנו כן עונים לביקורות בשמכם: לביקורת של 4-5 כוכבים התשובה מתפרסמת לבד, ולביקורת של 1-3 כוכבים אנחנו מכינים טיוטה שמחכה לאישור שלכם.' },
  { id: 'rank', q: 'תבטיחו מקום ראשון בגוגל?', a: 'לא.', more: 'אף אחד לא יכול להבטיח את זה, ואנחנו לא מבטיחים. אנחנו דואגים שהכרטיס יהיה מלא, פעיל ועונה ללקוחות.' },
  { id: 'website', q: 'צריך אתר?', a: 'לא.', more: 'כרטיס העסק בגוגל לא תלוי באתר. דף נחיתה לעסק כלול במנוי, והקישור אליו נכנס לכרטיס כשהדף מתפרסם.' },
  { id: 'nocard', q: 'אין לנו כרטיס עסק בגוגל, מה עושים?', a: 'מתחילים ביצירה שלו.', more: 'יש הדרכה צעד-צעד ליצירה ולאימות, ואפשר להמשיך בהכנות בזמן שמחכים לאישור של גוגל.' },
  { id: 'busy', q: 'אין לנו זמן ואנחנו לא טכנולוגיים. מתאים?', a: 'כן.', more: 'אחרי חיבור הכרטיס ואישור אחד של פרטי העסק, אנחנו עושים את העבודה השוטפת. אם נתקעתם, אפשר לכתוב לנו בוואטסאפ.' },
  { id: 'ai', q: 'זה עוזר גם בתשובות של צ\'אטים כמו ChatGPT?', a: 'אנחנו לא יכולים להבטיח שתופיעו בתשובה.', more: 'צ\'אטים וגוגל קוראים מידע שכתוב בצורה ברורה: שירותים, אזורי שירות ושעות. כרטיס מלא ומעודכן ודף נחיתה מסודר הם הבסיס לזה, והבדיקה החינמית מראה מה חסר.' },
  { id: 'time', q: 'כמה זמן לוקחת הבדיקה החינמית?', a: 'דקה.', more: 'כותבים שם עסק ועיר ומקבלים ציון ורשימה של מה לתקן קודם.' },
  { id: 'data', q: 'המידע שלנו נשאר שלנו?', a: 'כן.', more: 'המידע של העסק נשאר שלכם, ואפשר לנתק את החיבור לגוגל בכל רגע.' },
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

const focusRing = 'focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300';

function AuditCta({ location, tone = 'solid', className = '' }: { location: 'hero' | 'plans' | 'footer'; tone?: 'solid' | 'quiet'; className?: string }) {
  const solid = tone === 'solid';
  return (
    <Link
      to={auditHref(location)}
      onClick={() => trackEvent('seo_cta_audit_click', { location })}
      className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-7 py-3 text-base font-extrabold transition hover:-translate-y-0.5 ${focusRing} ${solid ? 'text-white shadow-lg shadow-blue-900/30' : 'bg-white/0 text-white ring-2 ring-white/40 hover:ring-white'} ${className}`}
      style={solid ? { backgroundColor: BLUE } : undefined}
    >
      בדקו את העסק שלכם בחינם <ArrowLeft size={18} aria-hidden />
    </Link>
  );
}

/** "המחשה": every illustrated number and business on this page carries this tag. */
function Illustration({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${dark ? 'bg-white/15 text-white' : 'bg-amber-100 text-amber-900'}`}>
      המחשה, לא עסק אמיתי
    </span>
  );
}

function Stars({ n = 5, size = 13 }: { n?: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n} מתוך 5 כוכבים`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={size} aria-hidden className={i < n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
      ))}
    </span>
  );
}

// ── Hero illustration: a phone showing an (invented) business listing, assembled in one sequence ──
function HeroPhone() {
  const reduce = useReducedMotion();
  const step = (i: number) => (reduce ? {} : {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay: 0.35 + i * 0.32, ease: 'easeOut' as const },
  });
  return (
    <figure className="relative mx-auto w-full max-w-[340px]" aria-label="המחשה: כרטיס עסק בגוגל שאנחנו מטפלים בו">
      <div className="absolute -top-3 right-4 z-20"><Illustration dark /></div>
      <div className="relative rounded-[2.4rem] bg-[#0A1836] p-2.5 shadow-2xl shadow-black/40 ring-1 ring-white/10">
        <div className="overflow-hidden rounded-[1.9rem] bg-white text-right">
          {/* listing header */}
          <div className="px-4 pb-3 pt-5" style={{ backgroundColor: PAPER }}>
            <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-slate-300" aria-hidden />
            <p className="text-lg font-black" style={{ color: NAVY }}>אינסטלציה כהן</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-600"><span className="font-bold text-slate-800">4.9</span><Stars size={11} /><span>· אינסטלטור · רמת גן</span></p>
            <p className="mt-1 text-xs font-semibold" style={{ color: LEAF }}>פתוח עכשיו · נסגר ב-18:00</p>
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-[11px] font-bold" style={{ color: BLUE }}>
              {[{ I: Phone, t: 'חיוג' }, { I: Navigation, t: 'מסלול' }, { I: Globe, t: 'אתר' }].map(({ I, t }) => (
                <span key={t} className="flex flex-col items-center gap-1 rounded-xl bg-white py-2 ring-1 ring-slate-200"><I size={15} aria-hidden />{t}</span>
              ))}
            </div>
          </div>

          <div className="space-y-2.5 px-3.5 py-3.5">
            {/* this week's post */}
            <motion.div {...step(0)} className="rounded-2xl p-3 ring-1 ring-blue-200" style={{ backgroundColor: '#EEF3FF' }}>
              <p className="flex items-center gap-1.5 text-[11px] font-bold" style={{ color: BLUE }}><PenLine size={12} aria-hidden /> הפוסט של השבוע</p>
              <p className="mt-1 text-[13px] leading-snug text-slate-800">הדוד מטפטף או שהמים כבר לא מתחממים כמו פעם? מחליפים דודי שמש ברמת גן ובגבעתיים, כולל פינוי הישן.</p>
              <p className="mt-1.5 text-[11px] font-semibold text-slate-500">יתפרסם ביום שלישי · אפשר לערוך עד אז</p>
            </motion.div>

            {/* a review and our reply */}
            <motion.div {...step(1)} className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
              <p className="flex items-center justify-between text-[12px]"><span className="font-bold text-slate-800">מיכל ל.</span><Stars size={11} /></p>
              <p className="mt-1 text-[12.5px] leading-snug text-slate-700">הגיעו באותו יום ופתרו את הנזילה. מקצועיים ונעימים.</p>
              <div className="mt-2 border-r-2 pr-2.5" style={{ borderColor: BLUE }}>
                <p className="text-[11px] font-bold text-slate-500">תגובת בעל העסק</p>
                <p className="text-[12.5px] leading-snug text-slate-700">תודה רבה מיכל, שמחנו לעזור עם הנזילה. אנחנו כאן בכל פעם שתצטרכו.</p>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* leads chip, floating off the phone */}
      <motion.div {...step(2)}
        className="absolute -bottom-7 left-3 z-20 rounded-2xl bg-white px-3.5 py-2.5 text-right shadow-xl ring-1 ring-slate-200 md:-left-12">
        <p className="text-2xl font-black leading-none" style={{ color: NAVY }}>22</p>
        <p className="mt-1 text-[11px] font-bold text-slate-600">פניות ישירות החודש</p>
      </motion.div>
    </figure>
  );
}

function SectionHead({ title, lead, light = false }: { title: string; lead?: string; light?: boolean }) {
  return (
    <div className="max-w-2xl">
      <h2 className={`text-[1.75rem] font-black leading-tight tracking-tight sm:text-4xl ${light ? 'text-white' : ''}`} style={light ? undefined : { color: NAVY }}>{title}</h2>
      {lead && <p className={`mt-3 text-lg leading-relaxed ${light ? 'text-blue-100' : 'text-slate-600'}`}>{lead}</p>}
    </div>
  );
}

// ── You / us ──
const YOU = [
  'מחברים את כרטיס העסק בגוגל, פעם אחת.',
  'מאשרים את פרטי העסק, פעם אחת.',
  'מבקשים ביקורות מהלקוחות, עם הודעת וואטסאפ וקוד QR מוכנים.',
  'קוראים ומאשרים טיוטת תשובה כשמגיעה ביקורת של 1-3 כוכבים.',
];
const US = [
  'כותבים ומפרסמים פוסט בכרטיס כל שבוע.',
  'עונים לביקורות של 4-5 כוכבים.',
  'בונים דף נחיתה לעסק ודפים לחיפושים באזור שלכם.',
  'שומרים על הכרטיס מעודכן: שעות, חגים, אתר ושירותים.',
  'שולחים דוח חודשי: מה עשינו ואיך הגיעו הפניות.',
];

function YouAndUs() {
  return (
    <section id="split" className="px-5 py-16 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <SectionHead title="מה אתם עושים, מה אנחנו עושים" lead="החלק שלכם קצר ורובו בהתחלה. השאר קורה כל שבוע, גם כשאתם עסוקים." />
        <div className="mt-10 grid overflow-hidden rounded-3xl ring-1 ring-slate-200 md:grid-cols-[2fr_3fr]">
          <div className="bg-white p-6 sm:p-8">
            <h3 className="text-xl font-black" style={{ color: NAVY }}>אתם</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">כמה דקות בהתחלה, ואחר כך רק כשרוצים</p>
            <ul className="mt-6 space-y-4">
              {YOU.map(t => (
                <li key={t} className="flex items-start gap-3 text-slate-700">
                  <span className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ring-2 ring-slate-400" aria-hidden />{t}
                </li>
              ))}
            </ul>
          </div>
          <div className="p-6 text-white sm:p-8" style={{ backgroundColor: NAVY }}>
            <h3 className="text-xl font-black">אנחנו</h3>
            <p className="mt-1 text-sm font-semibold text-blue-200">כל שבוע, לבד</p>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {US.map(t => (
                <li key={t} className="flex items-start gap-3 text-blue-50">
                  <Check size={18} className="mt-0.5 flex-shrink-0" style={{ color: CYAN }} aria-hidden />{t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── A normal week: Sunday to Saturday, Shabbat shaded ──
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function Week() {
  return (
    <section id="week" className="px-5 py-16 sm:py-24" style={{ backgroundColor: PAPER }}>
      <div className="mx-auto max-w-6xl">
        <SectionHead title="שבוע רגיל איתנו" lead="שבוע לדוגמה. בכל שלב אפשר לעצור, לערוך או לעבור לאישור ידני." />

        <ol className="mt-10 grid grid-cols-1 gap-1.5 sm:grid-cols-7 sm:gap-2" aria-label="שבוע לדוגמה">
          {DAYS.map((d, i) => {
            const shabbat = i === 6;
            const marks: Record<number, { t: string; c: string }> = {
              0: { t: 'הפוסט נכתב', c: BLUE },
              2: { t: 'מתפרסם', c: LEAF },
            };
            const m = marks[i];
            return (
              <li key={d}
                className={`relative flex min-h-[48px] items-center justify-between gap-2 rounded-xl px-3 py-2 sm:min-h-[104px] sm:flex-col sm:items-stretch sm:rounded-2xl sm:p-2.5 sm:text-center ${shabbat ? 'bg-slate-200/70' : 'bg-white ring-1 ring-slate-200'}`}>
                <span className={`text-sm font-bold ${shabbat ? 'text-slate-500' : 'text-slate-700'}`}>{d}</span>
                {m && <span className="rounded-md px-2 py-1 text-xs font-extrabold leading-tight text-white sm:px-1" style={{ backgroundColor: m.c }}>{m.t}</span>}
                {shabbat && <span className="flex items-center gap-1 text-xs font-bold leading-tight text-slate-500 sm:flex-col sm:gap-0.5"><Moon size={13} aria-hidden />לא מפרסמים</span>}
                {i === 1 && <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-bold leading-tight sm:px-1" style={{ color: BLUE }}>זמן לערוך</span>}
              </li>
            );
          })}
        </ol>

        <ul className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            { I: PenLine, t: 'פוסט חדש, ו-48 שעות לבדוק אותו', d: 'הפוסט נכתב רק מפרטי העסק שאישרתם. אפשר לקרוא, לשנות או לעצור. אם לא נגעתם, הוא מתפרסם לבד, אף פעם לא בשבת ולא בלילה.' },
            { I: Star, t: 'ביקורות נענות', d: 'לביקורת של 4-5 כוכבים התשובה יוצאת לבד. לביקורת של 1-3 כוכבים מחכה לכם טיוטה, והיא נשלחת רק כשתאשרו.' },
            { I: FileText, t: 'בסוף החודש: דוח', d: 'מה פרסמנו, לאילו ביקורות ענינו, וכמה פניות הגיעו ומאיפה.' },
          ].map(({ I, t, d }) => (
            <li key={t} className="border-t-2 pt-4" style={{ borderColor: NAVY }}>
              <h3 className="flex items-center gap-2 text-lg font-extrabold" style={{ color: NAVY }}><I size={19} aria-hidden />{t}</h3>
              <p className="mt-2 leading-relaxed text-slate-600">{d}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ── The listing, controlled from here ──
function ListingSync() {
  const rows: { I: typeof Globe; t: string; v: string; s: 'live' | 'pending' }[] = [
    { I: Globe, t: 'אתר', v: 'cohen-plumbing.pagey.co.il', s: 'live' },
    { I: Clock, t: 'שעות פעילות', v: 'א׳-ה׳ 08:00-18:00 · ו׳ 08:00-13:00', s: 'live' },
    { I: CalendarDays, t: 'חגים וימים מיוחדים', v: 'ערב חג: 08:00-12:00', s: 'pending' },
    { I: Phone, t: 'טלפונים', v: '052-555-0142', s: 'live' },
  ];
  return (
    <section id="listing" className="px-5 py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 md:grid-cols-2 [&>*]:min-w-0">
        <div>
          <SectionHead title="הכרטיס בגוגל מתעדכן מכאן" lead="לא צריך להיכנס לגוגל כדי לשנות פרט. משנים אצלנו, והשינוי עובר לכרטיס." />
          <ul className="mt-8 space-y-3.5 text-slate-700">
            {[
              'כשדף הנחיתה של העסק מתפרסם, הקישור אליו נכנס לכרטיס כאתר.',
              'שעות פעילות, וגם חגים וימים מיוחדים.',
              'טלפונים, תיאור העסק והשירותים.',
              'תמונות: שער, לוגו, העסק מבפנים ומבחוץ, הצוות והעבודות.',
              'שינוי שעשיתם ישירות בגוגל מתעדכן גם אצלנו, כדי שהפוסטים לא יכתבו שעות ישנות.',
            ].map(t => (
              <li key={t} className="flex items-start gap-3"><Check size={18} className="mt-0.5 flex-shrink-0" style={{ color: LEAF }} aria-hidden />{t}</li>
            ))}
          </ul>
          <p className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-200">
            גוגל לפעמים בודקת שינוי כמה ימים לפני שהוא מופיע. ליד כל פרט כתוב אם הוא כבר מופיע או ממתין לאישור.
          </p>
        </div>

        <figure className="relative rounded-3xl bg-white p-5 shadow-xl shadow-slate-900/10 ring-1 ring-slate-200 sm:p-6" aria-label="המחשה: מסך הכרטיס שלכם בגוגל באזור האישי">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="font-black" style={{ color: NAVY }}>הכרטיס שלכם בגוגל</p>
            <Illustration />
          </div>
          <ul className="divide-y divide-slate-100">
            {rows.map(({ I, t, v, s }) => (
              <li key={t} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: PAPER, color: NAVY }}><I size={17} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-800">{t}</span>
                  <span className={`block text-sm text-slate-500 ${t === 'אתר' ? 'truncate' : ''}`} dir={t === 'אתר' ? 'ltr' : undefined} style={t === 'אתר' ? { textAlign: 'right' } : undefined}>{v}</span>
                </span>
                {s === 'live'
                  ? <span className="flex-shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold" style={{ color: LEAF }}>מופיע בגוגל</span>
                  : <span className="flex-shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">ממתין לאישור</span>}
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-4 gap-2" aria-hidden>
            {['#C9D7F5', '#E3D4C4', '#CFE6DA', '#E8D1DA'].map((c, i) => (
              <span key={c} className="flex aspect-square items-end justify-center rounded-xl pb-1.5 text-[10px] font-bold text-slate-600" style={{ backgroundColor: c }}>
                {['שער', 'לוגו', 'צוות', 'עבודות'][i]}
              </span>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><ImageIcon size={13} aria-hidden /> תמונות בכרטיס</p>
        </figure>
      </div>
    </section>
  );
}

// ── How the leads arrived: a monthly report preview ──
function Report() {
  const direct = [
    { I: Phone, t: 'שיחות', n: 14 },
    { I: MessageCircle, t: 'וואטסאפ', n: 6 },
    { I: ListChecks, t: 'טפסים', n: 2 },
  ];
  return (
    <section id="report" className="px-5 py-16 sm:py-24" style={{ backgroundColor: NAVY }}>
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 md:grid-cols-[1fr_1.15fr] [&>*]:min-w-0">
        <div>
          <SectionHead light title="לא רק כמה פניות. גם איך הן הגיעו." lead="הדוח החודשי מפריד בין פניות ישירות לבין מי שרק ביקש מסלול, ומראה כמה פעמים הכרטיס הוצג ומאיפה הגיעו האנשים." />
          <ul className="mt-8 space-y-3 text-blue-50">
            {['שיחות, וואטסאפ וטפסים: פניות ישירות', 'בקשות מסלול מוצגות בנפרד, הן לא פנייה', 'כמה פעמים הכרטיס הוצג בחיפושים ובמפות', 'מאיפה: מהכרטיס בגוגל או מדף הנחיתה', 'ומה עשינו החודש: פוסטים ותשובות'].map(t => (
              <li key={t} className="flex items-start gap-3"><Check size={18} className="mt-0.5 flex-shrink-0" style={{ color: CYAN }} aria-hidden />{t}</li>
            ))}
          </ul>
        </div>

        <figure className="rounded-3xl bg-white p-5 text-right shadow-2xl shadow-black/30 sm:p-7" aria-label="המחשה: דוח חודשי">
          <div className="flex items-center justify-between gap-3">
            <p className="font-black" style={{ color: NAVY }}>הדוח של אוקטובר</p>
            <Illustration />
          </div>

          <div className="mt-5 flex items-end justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <p className="text-5xl font-black leading-none" style={{ color: NAVY }}>22</p>
              <p className="mt-1.5 text-sm font-bold text-slate-600">פניות ישירות</p>
            </div>
            <div className="text-left">
              <p className="flex items-center justify-end gap-1.5 text-2xl font-black" style={{ color: BLUE }}><Search size={18} aria-hidden />840</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">הצגות בחיפושים ובמפות</p>
            </div>
          </div>

          <ul className="mt-5 grid grid-cols-3 gap-2.5">
            {direct.map(({ I, t, n }) => (
              <li key={t} className="rounded-2xl p-3" style={{ backgroundColor: PAPER }}>
                <I size={16} style={{ color: NAVY }} aria-hidden />
                <p className="mt-2 text-2xl font-black" style={{ color: NAVY }}>{n}</p>
                <p className="text-xs font-bold text-slate-600">{t}</p>
              </li>
            ))}
          </ul>

          <p className="mt-3 flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600">
            <MapPin size={15} aria-hidden /> 7 בקשות מסלול, לא נספרות כפנייה
          </p>

          <div className="mt-5">
            <p className="text-sm font-bold text-slate-700">מאיפה הגיעו הפניות</p>
            <div className="mt-2 flex h-3 overflow-hidden rounded-full" role="img" aria-label="15 מהכרטיס בגוגל, 7 מדף הנחיתה">
              <span style={{ width: '68%', backgroundColor: BLUE }} />
              <span style={{ width: '32%', backgroundColor: CYAN }} />
            </div>
            <div className="mt-2 flex justify-between text-xs font-semibold text-slate-600">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BLUE }} aria-hidden />מהכרטיס בגוגל: 15</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CYAN }} aria-hidden />מדף הנחיתה: 7</span>
            </div>
          </div>

          <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">החודש: 4 פוסטים בכרטיס, 9 תשובות לביקורות.</p>
        </figure>
      </div>
    </section>
  );
}

function Fair() {
  return (
    <section id="fair" className="px-5 py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1fr_1.3fr]">
        <div>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: PAPER, color: LEAF }}><ShieldCheck size={26} aria-hidden /></div>
          <SectionHead title="קידום הוגן" lead="אנחנו לא מבטיחים מקום ראשון בגוגל, כי אי אפשר להבטיח את זה. מה שכן מבטיחים:" />
        </div>
        <ul className="divide-y divide-slate-200 self-center border-y border-slate-200">
          {[
            'בלי הבטחת דירוג.',
            'בלי ביקורות מזויפות: את הביקורת הלקוח כותב בעצמו. אנחנו עוזרים לבקש אותה מכל לקוח, ועונים לביקורות בשמכם לפי ההגדרות שבחרתם.',
            'בלי מאות דפים גנריים ובלי קניית קישורים.',
            'כל מה שמתפרסם בשמכם מבוסס רק על פרטי העסק שאישרתם, ואפשר לעצור כל דבר.',
            'המידע של העסק נשאר שלכם.',
          ].map(t => (
            <li key={t} className="py-4 leading-relaxed text-slate-700">{t}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const INCLUDED = [
  'פוסט בכרטיס כל שבוע',
  'תשובות לביקורות טובות, וטיוטה לאישורכם לביקורת שלילית',
  'דף נחיתה לעסק ודפים לחיפושים באזור שלכם',
  'עריכת הכרטיס בגוגל מהאזור האישי, כולל תמונות',
  'דוח חודשי: מה עשינו ואיך הגיעו הפניות',
  'ערכה לבקשת ביקורות מהלקוחות',
];

function Plans({ plansRef, conciergeHref }: { plansRef: React.RefObject<HTMLElement | null>; conciergeHref: string | null }) {
  const [cycle, setCycle] = useState<'month' | 'year'>('month');
  const price = PRICE[cycle];
  const savings = PRICE.month * 12 - PRICE.year;
  return (
    <section id="plans" ref={plansRef} className="px-5 py-16 sm:py-24" style={{ backgroundColor: PAPER }}>
      <div className="mx-auto max-w-6xl">
        <SectionHead title="מנוי אחד, הכל כלול" lead="אותו מנוי, חודשי או שנתי. דף הנחיתה של העסק כלול בשניהם." />

        <div className="mt-10 grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
          <article className="rounded-3xl bg-white p-6 shadow-xl shadow-slate-900/5 ring-1 ring-slate-200 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h3 className="text-xl font-black" style={{ color: NAVY }}>קידום העסק בגוגל</h3>
              <div className="inline-flex rounded-full p-1" style={{ backgroundColor: PAPER }} role="group" aria-label="תקופת המנוי">
                {(['month', 'year'] as const).map(c => (
                  <button key={c} type="button" aria-pressed={cycle === c} onClick={() => setCycle(c)}
                    className={`min-h-[40px] rounded-full px-4 text-sm font-extrabold transition ${focusRing} ${cycle === c ? 'bg-white shadow ring-1 ring-slate-200' : 'text-slate-600 hover:text-slate-900'}`}
                    style={cycle === c ? { color: NAVY } : undefined}>
                    {c === 'month' ? 'חודשי' : 'שנתי'}
                  </button>
                ))}
              </div>
            </div>

            <p className="mt-6 flex flex-wrap items-baseline gap-x-2" aria-live="polite">
              <span className="text-5xl font-black tracking-tight" style={{ color: NAVY }}>₪{price.toLocaleString('he-IL')}</span>
              <span className="text-lg font-bold text-slate-600">{cycle === 'month' ? 'לחודש' : 'לשנה'}, כולל מע"מ</span>
            </p>
            <p className="mt-1.5 min-h-[1.5rem] text-sm font-bold" style={{ color: LEAF }}>
              {cycle === 'year' ? `חוסכים ₪${savings.toLocaleString('he-IL')} לעומת 12 חודשים` : 'אפשר לבטל מתי שרוצים, מהאזור האישי'}
            </p>

            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {INCLUDED.map(t => (
                <li key={t} className="flex items-start gap-2.5 text-slate-700"><Check size={18} className="mt-0.5 flex-shrink-0" style={{ color: LEAF }} aria-hidden />{t}</li>
              ))}
            </ul>

            <p className="mt-6 text-sm leading-relaxed text-slate-500">חודשי: מתחדש כל חודש עד שמבטלים. שנתי: תשלום אחד, לא מתחדש מעצמו. בלי הבטחת דירוג.</p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link to="/seo-plan" onClick={() => { trackEvent('seo_cta_plan_click', { cycle }); trackEvent('seo_plan_click', { plan: 'subscription', cycle }); }}
                className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-7 py-3 text-base font-extrabold text-white shadow-lg shadow-blue-900/20 transition hover:-translate-y-0.5 ${focusRing}`}
                style={{ backgroundColor: BLUE }}>
                להצטרפות למנוי <ArrowLeft size={18} aria-hidden />
              </Link>
              {conciergeHref && (
                <a href={conciergeHref} target="_blank" rel="noopener noreferrer"
                  onClick={() => { trackEvent('seo_plan_click', { plan: 'premium' }); trackEvent('Concierge_Clicked', { location: 'seo' }); }}
                  className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-3 text-sm font-bold text-slate-700 underline-offset-4 hover:underline ${focusRing}`}>
                  <MessageCircle size={16} aria-hidden /> שאלות? דברו איתנו בוואטסאפ
                </a>
              )}
            </div>
          </article>

          <aside className="rounded-3xl p-6 text-white sm:p-8" style={{ backgroundColor: NAVY }}>
            <h3 className="text-xl font-black">לא בטוחים עדיין?</h3>
            <p className="mt-2 leading-relaxed text-blue-100">התחילו בבדיקה חינמית של הכרטיס: ציון, השוואה לעסקים דומים באזור, ורשימה של מה לתקן קודם. דקה, בלי הרשמה.</p>
            <Link to={auditHref('plans')} onClick={() => { trackEvent('seo_plan_click', { plan: 'basic' }); trackEvent('seo_cta_audit_click', { location: 'plans' }); }}
              className={`mt-6 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 font-extrabold transition hover:bg-blue-50 sm:w-auto ${focusRing}`}
              style={{ color: NAVY }}>
              לבדיקה החינמית <ArrowLeft size={18} aria-hidden />
            </Link>
          </aside>
        </div>
      </div>
    </section>
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

  const toPlans = () => {
    trackEvent('seo_cta_plan_click', { location: 'hero' });
    document.getElementById('plans')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div dir="rtl" className="min-h-screen bg-white font-sans text-slate-800">
      <Helmet>
        <title>קידום העסק בגוגל: מנוי שעובד בשבילכם כל שבוע | Pagey</title>
        <meta name="description" content="מנוי לקידום העסק בגוגל: פוסט בכרטיס כל שבוע, תשובות לביקורות, דף נחיתה, עריכת הכרטיס מהאזור האישי ודוח חודשי שמראה איך הגיעו הפניות. ₪250 לחודש או ₪2,500 לשנה, כולל מע״מ. בלי הבטחת דירוג." />
        <link rel="canonical" href="https://pagey.co.il/seo" />
        <script type="application/ld+json">{JSON.stringify(ld)}</script>
      </Helmet>

      {/* 1. Hero */}
      <header className="relative overflow-hidden px-5 pb-20 pt-6 sm:pb-24" style={{ backgroundColor: NAVY }}>
        <nav className="mx-auto flex max-w-6xl items-center justify-between" aria-label="ראשי">
          <Link to="/" className={`rounded text-xl font-black text-white ${focusRing}`}>Pagey</Link>
          <Link to="/login" className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-bold text-blue-100 hover:text-white ${focusRing}`}>כניסה</Link>
        </nav>

        {/* a quiet search-map grid behind the hero, the one decorative touch on the page */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '56px 56px' }} />

        <div className="relative mx-auto mt-10 grid max-w-6xl items-center gap-14 sm:mt-14 md:grid-cols-[1.15fr_1fr]">
          <div>
            <h1 className="text-[2.35rem] font-black leading-[1.12] tracking-tight text-white sm:text-6xl">
              הכרטיס שלכם בגוגל עובד כל שבוע, גם כשאתם עסוקים
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-blue-100 sm:text-xl">
              אנחנו מפרסמים פוסט, עונים לביקורות, שומרים על הפרטים מעודכנים ושולחים דוח שמראה מאיפה הגיעו הפניות. אתם עובדים, ואנחנו דואגים שימצאו אתכם.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <AuditCta location="hero" />
              <button type="button" onClick={toPlans}
                className={`inline-flex min-h-[48px] items-center justify-center rounded-full px-6 text-base font-bold text-white ring-2 ring-white/35 transition hover:ring-white ${focusRing}`}>
                לתוכנית ולמחיר
              </button>
            </div>
            <p className="mt-4 text-sm text-blue-200">הבדיקה חינמית, לוקחת דקה ולא דורשת הרשמה. המנוי: ₪250 לחודש, כולל מע"מ.</p>
          </div>
          <HeroPhone />
        </div>
      </header>

      <main>
        <YouAndUs />
        <Week />
        <ListingSync />
        <Report />
        <Fair />
        <Plans plansRef={plansRef} conciergeHref={conciergeHref} />

        {/* FAQ: answer first, then the short explanation; native <details> so it works without JS */}
        <section id="faq" className="px-5 py-16 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1fr_2fr]">
            <SectionHead title="שאלות נפוצות" lead="תשובה קודם, ואז הסבר קצר." />
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {FAQ.map(f => (
                <details key={f.id} className="group py-1" onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) trackEvent('seo_faq_open', { question_id: f.id }); }}>
                  <summary className={`flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 text-lg font-bold ${focusRing}`} style={{ color: NAVY }}>
                    <span>{f.q}</span>
                    <ChevronDown size={20} className="flex-shrink-0 transition group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="pb-4 leading-relaxed text-slate-600"><strong className="text-slate-800">{f.a}</strong> {f.more}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="px-5 py-16 sm:py-20" style={{ backgroundColor: NAVY }}>
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-black text-white sm:text-3xl">רוצים לראות מה רואים כשמחפשים אתכם?</h2>
              <p className="mt-2 flex items-center gap-1.5 text-blue-200"><Search size={15} aria-hidden /> בדיקה חינמית, דקה, בלי הרשמה.</p>
            </div>
            <AuditCta location="footer" />
          </div>
        </section>
      </main>

      <footer className="px-5 py-8 text-center text-xs text-slate-500">
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2" aria-label="קישורים">
          <Link to="/" className="inline-flex min-h-[44px] items-center px-1 hover:underline">Pagey</Link>
          <Link to="/privacy" className="inline-flex min-h-[44px] items-center px-1 hover:underline">מדיניות פרטיות</Link>
          <Link to="/terms" className="inline-flex min-h-[44px] items-center px-1 hover:underline">תנאי שימוש</Link>
          <Link to="/accessibility" className="inline-flex min-h-[44px] items-center px-1 hover:underline">הצהרת נגישות</Link>
        </nav>
      </footer>
    </div>
  );
}
