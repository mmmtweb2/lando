import { useState } from 'react';
import { ClipboardCheck, FileText, MessageSquare, Pencil, PencilLine, RefreshCw, Send, SkipForward, Sparkles, type LucideIcon } from 'lucide-react';
import { Skeleton } from '../../ui';
import { ACTIVITY, ACTIVITY_LABEL, ACTIVITY_LABEL_OTHER } from '../autopilotCopy';
import { LoadError } from './bits';
import { relTime } from './format';
import type { Activity, ActivityKind, Loadable } from './types';

// "מה עשינו בשבילכם": the log of what we did, newest first.

const ICON: Record<ActivityKind, LucideIcon> = {
  card_synced: RefreshCw, card_approved: ClipboardCheck,
  post_planned: PencilLine, post_published: Send, post_skipped: SkipForward,
  reply_published: MessageSquare, reply_drafted: Pencil,
  page_created: FileText,
};
const SHORT = 5;

export default function ActivityFeed({ activity, onRetry }: { activity: Loadable<Activity[]>; onRetry: () => void }) {
  const [all, setAll] = useState(false);
  const items = activity.status === 'ok' ? [...activity.data].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const shown = all ? items : items.slice(0, SHORT);
  return (
    <section className="dv3-block dv3-a-feedblock" aria-labelledby="dv3-activity">
      <h3 id="dv3-activity">{ACTIVITY.title}</h3>
      <p className="dv3-a-sub">{ACTIVITY.hint}</p>
      {activity.status === 'loading' && <div className="flex flex-col gap-3" aria-busy="true" aria-label="טוען"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
      {activity.status === 'error' && <LoadError text={ACTIVITY.error} onRetry={onRetry} />}
      {activity.status === 'ok' && items.length === 0 && (
        <div className="dv3-a-emptybox">
          <strong>{ACTIVITY.empty}</strong>
          <p>{ACTIVITY.emptySub}</p>
        </div>
      )}
      {shown.length > 0 && (
        <ol className="dv3-a-feed">
          {shown.map((it) => {
            const Icon = ICON[it.kind as ActivityKind] ?? Sparkles;
            return (
              <li key={it.id}>
                <span className="dv3-row-icon" aria-hidden><Icon size={18} /></span>
                <div>
                  <p className="dv3-a-feed-title">{it.title}</p>
                  {it.detail && <p className="dv3-a-feed-detail">{it.detail}</p>}
                  <p className="dv3-a-feed-meta">
                    <span className="dv3-state">{ACTIVITY_LABEL[it.kind as ActivityKind] ?? ACTIVITY_LABEL_OTHER}</span>
                    <time dateTime={it.createdAt}>{relTime(it.createdAt)}</time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > SHORT && (
        <button type="button" className="dv3-linkbtn" aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? ACTIVITY.less : ACTIVITY.more}</button>
      )}
    </section>
  );
}
