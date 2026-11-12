import { ClipboardCheck, FileText, MessageSquare, Pencil, PencilLine, RefreshCw, Send, SkipForward, Sparkles, type LucideIcon } from 'lucide-react';
import { Skeleton } from '../../ui';
import { ACTIVITY, ACTIVITY_LABEL, ACTIVITY_LABEL_OTHER } from '../autopilotCopy';
import { LoadError } from './bits';
import { relTime } from './format';
import type { Activity, ActivityKind, Loadable } from './types';

// "מה עשינו בשבילכם": what we did, newest first. Three lines on the home, the whole list on its own screen.

const ICON: Record<ActivityKind, LucideIcon> = {
  card_synced: RefreshCw, card_approved: ClipboardCheck,
  post_planned: PencilLine, post_published: Send, post_skipped: SkipForward,
  reply_published: MessageSquare, reply_drafted: Pencil,
  page_created: FileText,
};

const newestFirst = (items: Activity[]) => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** The last few actions, one line each: the home's "what we did" column. */
export function ActivityLines({ activity, limit, onRetry, empty }: { activity: Loadable<Activity[]>; limit: number; onRetry: () => void; empty: string }) {
  if (activity.status === 'loading') return <div className="flex flex-col gap-2" aria-busy="true" aria-label="טוען"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
  if (activity.status === 'error') return <LoadError text={ACTIVITY.error} onRetry={onRetry} />;
  const items = newestFirst(activity.data).slice(0, limit);
  if (items.length === 0) return <p className="dv4-quiet">{empty}</p>;
  return (
    <ol className="dv4-lines">
      {items.map((it) => {
        const Icon = ICON[it.kind as ActivityKind] ?? Sparkles;
        return (
          <li key={it.id}>
            <span className="dv4-icon dv4-icon-sm" aria-hidden><Icon size={16} /></span>
            <p>{it.title} <time dateTime={it.createdAt}>{relTime(it.createdAt)}</time></p>
          </li>
        );
      })}
    </ol>
  );
}

/** The whole list, on its own screen. */
export default function ActivityFeed({ activity, onRetry }: { activity: Loadable<Activity[]>; onRetry: () => void }) {
  const items = activity.status === 'ok' ? newestFirst(activity.data) : [];
  return (
    <section className="dv4-card" aria-label={ACTIVITY.title}>
      {activity.status === 'loading' && <div className="flex flex-col gap-3" aria-busy="true" aria-label="טוען"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
      {activity.status === 'error' && <LoadError text={ACTIVITY.error} onRetry={onRetry} />}
      {activity.status === 'ok' && items.length === 0 && (
        <div className="dv4-empty">
          <strong>{ACTIVITY.empty}</strong>
          <p>{ACTIVITY.emptySub}</p>
        </div>
      )}
      {items.length > 0 && (
        <ol className="dv3-a-feed">
          {items.map((it) => {
            const Icon = ICON[it.kind as ActivityKind] ?? Sparkles;
            return (
              <li key={it.id}>
                <span className="dv4-icon" aria-hidden><Icon size={18} /></span>
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
    </section>
  );
}
