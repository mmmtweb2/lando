import { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Terms-of-use + accessibility block for a CUSTOMER-GENERATED page (/p/:slug).
//
// Why it lives on the generated page and not only on pagey.co.il: accessibility
// duties under חוק שוויון זכויות לאנשים עם מוגבלות, התשנ"ח-1998 and תקנות
// שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע"ג-2013 attach to
// the business whose service the site provides — i.e. to Pagey's CUSTOMER, not
// to Pagey. A page published for a business with no accessibility statement at
// all is the customer's exposure, so every generated page carries its own,
// named for that business.
//
// Everything here is templated from data the page object already has
// (business_name / phone / email / address). This component reads no AI content
// beyond the contact block and generates nothing.
//
// Presentation: collapsed by default to a single quiet line, so it never
// competes with the business's own design; when opened it inherits the page's
// own accent colour and sits inside the same dark footer band as the contact
// section, rather than looking like a bolted-on foreign block.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  businessName: string;
  phone?: string;
  email?: string;
  address?: string;
  /** The page's own accent colour, so the block matches its generated design. */
  accent: string;
  /** Extra bottom padding when the owner's edit toolbar is on screen. */
  extraBottomPad?: boolean;
}

export default function PageLegalFooter({
  businessName, phone, email, address, accent, extraBottomPad = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const name = businessName?.trim() || 'העסק';
  const hasContact = !!(phone || email);

  // How a visitor reaches the business about an accessibility problem. Falls
  // back to the page's own contact form when the business published neither a
  // phone nor an email — never leaves the statement without a channel.
  const contactLine = hasContact
    ? [phone ? `טלפון: ${phone}` : null, email ? `דוא"ל: ${email}` : null].filter(Boolean).join(' · ')
    : 'באמצעות טופס יצירת הקשר בדף זה';

  return (
    <section className={`bg-slate-900 text-slate-400 px-6 ${extraBottomPad ? 'pb-24' : 'pb-8'}`} dir="rtl">
      <div className="max-w-2xl mx-auto border-t border-white/10 pt-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mx-auto flex items-center gap-1.5 text-xs hover:text-white transition"
        >
          <span>תנאי שימוש ונגישות</span>
          <span aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
        </button>

        {open && (
          <div className="mt-5 flex flex-col gap-5 text-right text-[12px] leading-[1.85] text-slate-400">

            <div>
              <h3 className="text-[13px] font-bold text-slate-200 mb-1.5" style={{ color: accent }}>תנאי שימוש</h3>
              <p>
                דף זה מופעל על ידי {name} ומיועד למסירת מידע על העסק ולפנייה אליו. המידע המוצג בדף,
                לרבות תיאורי שירותים, מחירים, שעות פעילות וזמינות, ניתן כמות שהוא ועשוי להשתנות מעת לעת.
                אין לראות במידע שבדף הצעה מחייבת, ייעוץ מקצועי או התחייבות למתן שירות, ואין להסתמך עליו
                כתחליף לבירור ישיר מול {name}.
              </p>
              <p className="mt-2">
                פנייה באמצעות טופס יצירת הקשר או באמצעות פרטי הקשר שבדף מהווה הסכמה לכך ש{name} יעשה שימוש
                בפרטים שמסרתם לצורך חזרה אליכם ומענה לפנייתכם. אין למסור בטופס מידע רגיש שאינו נדרש לצורך
                הפנייה.
              </p>
              <p className="mt-2">
                קישורים לאתרים או לעמודים חיצוניים, ככל שקיימים בדף, ניתנים לנוחותכם בלבד. אין ל{name} שליטה
                על תוכנם והוא אינו אחראי להם. תוכן הדף, לרבות טקסטים, תמונות, לוגו וסימנים מסחריים, מיועד
                לשימושו של {name}; אין להעתיקו או לעשות בו שימוש מסחרי ללא רשות. על השימוש בדף יחולו דיני
                מדינת ישראל.
              </p>
            </div>

            <div>
              <h3 className="text-[13px] font-bold text-slate-200 mb-1.5" style={{ color: accent }}>הצהרת נגישות</h3>
              <p>
                {name} רואה חשיבות במתן שירות לכלל הציבור, לרבות אנשים עם מוגבלות, ופועל לשיפור נגישות הדף
                בהתאם לחוק שוויון זכויות לאנשים עם מוגבלות, התשנ"ח-1998 ולתקנות שהותקנו מכוחו.
              </p>
              <p className="mt-2">
                הדף נבנה בתשתית התומכת בנגישות: תוכן בעברית בכיוון מימין לשמאל, מבנה כותרות סמנטי, שדות טופס
                בעלי תוויות, טקסט חלופי לתמונות, ניווט באמצעות מקלדת ותצוגה המותאמת לגדלי מסך שונים ולהגדלת
                התצוגה בדפדפן. עם זאת, הדף טרם עבר ביקורת נגישות חיצונית ואינו מצהיר על עמידה מלאה בתקן
                הישראלי ת"י 5568, וייתכנו בו רכיבים שאינם נגישים במלואם.
              </p>
              <p className="mt-2">
                נתקלתם בקושי בשימוש בדף? נשמח שתפנו אלינו ונפעל לתקן. {contactLine}
                {address ? ` · כתובת: ${address}` : ''}
              </p>
              <p className="mt-2 text-slate-500">
                האחריות לתוכן הדף ולהנגשתו היא של {name}, המפעיל את הדף.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
