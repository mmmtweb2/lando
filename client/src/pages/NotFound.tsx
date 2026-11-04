import { useEffect } from 'react';
import { Link } from 'react-router-dom';

// Unknown address. The server answers 404 for it too (src/app.ts), and noindex keeps it out of search.
export default function NotFound() {
  useEffect(() => {
    const prev = document.title;
    document.title = 'העמוד לא נמצא | Pagey';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => { document.title = prev; meta.remove(); };
  }, []);
  return (
    <main dir="rtl" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-bold text-slate-900">העמוד לא נמצא</h1>
      <p className="text-sm text-slate-600">הכתובת שגויה או שהעמוד הוסר. אפשר לחזור לדף הראשי או לבדוק את כרטיס העסק שלכם בגוגל.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/" className="rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2552d0]">לדף הראשי</Link>
        <Link to="/audit" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">בדיקה חינמית</Link>
      </div>
    </main>
  );
}
