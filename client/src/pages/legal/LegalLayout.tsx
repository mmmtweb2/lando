import { type ReactNode, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LandoMark } from '../../components/Lando';

// Shared shell for the three public legal pages (/privacy, /terms,
// /accessibility). Deliberately plain: same palette and rounding as the
// marketing page (PRIMARY #2E63F6 on #EEF1FB), but no animation and no
// decoration — a legal page has to be readable, printable and quotable.

const PRIMARY = '#2E63F6';

/** Section heading + body. `id` gives every clause a linkable anchor. */
export function LegalSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-9 first:mt-0 scroll-mt-24">
      <h2 className="text-lg sm:text-xl font-extrabold text-[#0E2148]">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-[1.9] text-slate-700">{children}</div>
    </section>
  );
}

/** A numbered / bulleted list of clauses. */
export function LegalList({ items, ordered = false }: { items: ReactNode[]; ordered?: boolean }) {
  const cls = 'flex flex-col gap-2.5 pr-5 text-[15px] leading-[1.9] text-slate-700';
  return ordered
    ? <ol className={`${cls} list-decimal`}>{items.map((t, i) => <li key={i}>{t}</li>)}</ol>
    : <ul className={`${cls} list-disc`}>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>;
}

export default function LegalLayout({
  title, updated, intro, children,
}: { title: string; updated: string; intro?: ReactNode; children: ReactNode }) {
  // Each legal page is its own document — land at the top of it, not wherever
  // the previous page happened to be scrolled to.
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div dir="rtl" className="min-h-screen bg-[#EEF1FB] text-slate-800">
      <header className="bg-white border-b border-[#DCE4F7]">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold text-[#0E2148]">
            <LandoMark size={26} />
            <span>Pagey</span>
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline" style={{ color: PRIMARY }}>
            חזרה לאתר <ArrowLeft size={15} />
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 sm:py-14">
        <article className="rounded-xl bg-white border border-[#DCE4F7] shadow-sm p-6 sm:p-10">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0E2148]">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">עודכן לאחרונה: {updated}</p>
          {intro && <div className="mt-5 text-[15px] leading-[1.9] text-slate-700 flex flex-col gap-3">{intro}</div>}
          <div className="mt-8">{children}</div>
        </article>

        <nav className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
          <Link to="/terms" className="hover:text-[#2E63F6] transition">תנאי שימוש</Link>
          <Link to="/privacy" className="hover:text-[#2E63F6] transition">מדיניות פרטיות</Link>
          <Link to="/accessibility" className="hover:text-[#2E63F6] transition">הצהרת נגישות</Link>
        </nav>
      </main>
    </div>
  );
}
