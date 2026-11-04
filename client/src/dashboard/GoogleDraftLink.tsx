import { ArrowLeft, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { OverviewInput } from './journey';
import { googleDraftPath, showGoogleDraft } from './googleDraft';

/** One small line on the dashboard home; logic in googleDraft.ts. Nothing is fetched here. */
export default function GoogleDraftLink({ input }: { input: OverviewInput }) {
  if (!showGoogleDraft(input) || !input.businessId) return null;
  return (
    <section className="dv2-card-flat flex flex-wrap items-center justify-between gap-3 p-4" aria-labelledby="dv2-gdraft">
      <div className="flex items-start gap-2">
        <Sparkles size={16} className="mt-1 flex-shrink-0 text-[var(--accent-strong)]" aria-hidden />
        <div>
          <h2 id="dv2-gdraft" className="text-[15px] font-bold text-[var(--ink)]">עוד אין לעסק דף נחיתה</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">אפשר ליצור טיוטה מנתוני הכרטיס בגוגל. אתם בודקים ומתקנים, והדף לא מתפרסם לבד.</p>
        </div>
      </div>
      <Link to={googleDraftPath(input.businessId)} className="dv2-btn-ghost inline-flex min-h-[44px] items-center gap-1">
        יצירת טיוטה <ArrowLeft size={16} aria-hidden />
      </Link>
    </section>
  );
}
