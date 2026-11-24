import { Link } from 'react-router-dom';
import { ExternalLink, FileText } from 'lucide-react';
import type { PageSummary } from '../shell/bridge';
import { orderPages } from './pageOrder';

// "הדפים שלכם" inside "תוכן ודפים" (README part 149): EVERY page of the account, published or not, made before or
// after the business was connected, newest first. Until now a page made before connecting a business showed
// nowhere in the promotion screens. The business's own page is marked and listed first.

const STATUS: Record<string, string> = { published: 'פורסם', draft: 'טיוטה', frozen: 'לא פעיל, אפשר לחדש' };

const dateHe = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
};

export default function MyPagesCard({ pages, ownPageId }: { pages: readonly PageSummary[]; ownPageId: string | null }) {
  const list = orderPages(pages, ownPageId);
  return (
    <section className="dv4-card dv4-mypages" aria-labelledby="dv4-mypages">
      <div className="dv4-card-head"><h3 id="dv4-mypages">הדפים שלכם</h3></div>
      {list.length === 0 ? (
        <p className="dv4-quiet">
          עוד אין לכם דף. <Link to="/create" className="dv4-mypages-link">ליצירת דף</Link>
        </p>
      ) : (
        <ul>
          {list.map((p) => (
            <li key={p.id}>
              <FileText size={18} aria-hidden />
              <div>
                <strong>{p.name}</strong>
                <small>
                  {STATUS[p.status] ?? STATUS.draft}
                  {p.createdAt && ` · נוצר ב-${dateHe(p.createdAt)}`}
                  {p.id === ownPageId && ' · הדף של העסק'}
                </small>
              </div>
              <span className="dv4-mypages-actions">
                <Link to={`/p/${encodeURIComponent(p.slug)}`} className="dv4-mypages-link">עריכה<span className="sr-only"> של {p.name}</span></Link>
                {p.status === 'published' && (
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="dv4-mypages-link">
                    צפייה<span className="sr-only"> ב{p.name} (בלשונית חדשה)</span> <ExternalLink size={13} aria-hidden />
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
