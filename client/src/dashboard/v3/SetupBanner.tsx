import { ListChecks } from 'lucide-react';
import { MENU_COPY } from '../shell/setupMode';

/**
 * Above an area's own screen while the setup is not finished (README part 149). It never replaces the screen:
 * it says so in one line and offers the way back to the setup.
 */
export default function SetupBanner({ onSetup, progress }: { onSetup: () => void; progress: { done: number; total: number } | null }) {
  const c = MENU_COPY.banner;
  return (
    <aside className="dv4-setupbanner" aria-label={c.title}>
      <ListChecks size={20} aria-hidden />
      <div>
        <p className="dv4-setupbanner-title">
          {c.title}
          {progress && <span> ({progress.done} מתוך {progress.total} צעדים הושלמו)</span>}
        </p>
        <p>{c.line}</p>
      </div>
      <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={onSetup}>{c.action}</button>
    </aside>
  );
}
