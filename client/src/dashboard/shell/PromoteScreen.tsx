import { Link } from 'react-router-dom';
import { MessageSquareText, Search, Star } from 'lucide-react';

// "קידום העסק בגוגל" inside the dashboard, for an account that holds only the pages product (README part 149).
// The sidebar used to send this entry straight to the public /seo page. Now it stays in the dashboard, says in
// plain words what the product does, and links to the public page for the details and the price.

const POINTS = [
  { icon: Search, title: 'הכרטיס שלכם בגוגל מפות', text: 'בודקים מה חסר בכרטיס, ומשלימים אותו יחד אתכם.' },
  { icon: Star, title: 'ביקורות', text: 'קישור מוכן לבקשת ביקורת, וטיוטות לתשובות על ביקורות.' },
  { icon: MessageSquareText, title: 'פניות ותוכן', text: 'רואים מה מגיע מגוגל, ומקבלים תוכן לחיפושים של העסק.' },
] as const;

export default function PromoteScreen() {
  return (
    <section className="flex flex-col gap-4" aria-label="מה זה קידום העסק בגוגל">
      <div className="rounded-2xl border border-[#DCE3F2] bg-white p-5 sm:p-6">
        <p className="text-[15px] leading-relaxed text-slate-700">
          קידום בגוגל עוזר לעסק להופיע כשמחפשים אותו בגוגל ובגוגל מפות. זה מוצר נפרד מדפי הנחיתה, והדפים שלכם נשארים כמו שהם.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl bg-[#F6F8FE] p-4">
              <Icon size={18} className="text-[#2E63F6]" aria-hidden />
              <p className="mt-2 text-sm font-bold text-slate-900">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link to="/seo" className="inline-flex min-h-[44px] items-center rounded-xl bg-[#2E63F6] px-5 text-sm font-bold text-white hover:bg-[#2552d0]">
            לפרטים ולמחיר
          </Link>
          <Link to="/audit" className="inline-flex min-h-[44px] items-center rounded-xl border border-[#DCE3F2] px-5 text-sm font-semibold text-slate-700 hover:bg-[#F6F8FE]">
            בדיקה חינמית של הכרטיס בגוגל
          </Link>
        </div>
        <p className="mt-3 text-xs text-slate-500">הקישורים נפתחים בעמוד המידע של Pagey. אפשר לחזור לכאן מהתפריט.</p>
      </div>
    </section>
  );
}
