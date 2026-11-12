import { useCallback, useId, useState } from 'react';
import { Skeleton } from '../../ui';
import { NeedChip } from '../parts';
import { POST } from '../autopilotCopy';
import { LoadError, Notice } from './bits';
import { dayAndHour, relTime } from './format';
import type { Autopilot } from './useAutopilot';
import type { Automation, Post } from './types';

// "הפוסט הבא", compact (docs/dashboard-v4-spec.md): when it goes out, the text (clamped), and the
// three things the owner may do. The post is automatic, so there are no three headed parts here:
// one line of what we do and the "אין צורך להתערב" tag. The published posts live on the activity screen.

const MAX_POST = 1500;
/** shorter than this, the text is shown whole and there is nothing to expand */
const CLAMP_FROM = 150;

/** When the post really goes out: the server's `expectedAt` when it sent one, else the end of the edit window. */
function whenLine(p: Post, a: Automation | null): string {
  if (p.problem === 'quota_pending') return POST.whenQuota;
  if (p.problem === 'failed') return POST.whenFailed;
  if (a && !a.live) return POST.whenNotLive;
  if (a?.postsMode === 'approve') return POST.whenApprove;
  if (a?.postsMode === 'off') return POST.whenOff;
  const at = p.expectedAt || p.publishAfter;
  return new Date(at).getTime() <= Date.now() ? POST.whenSoon : POST.whenAuto(dayAndHour(at));
}

function Actions({ post, auto, waits }: { post: Post; auto: Autopilot; waits: boolean }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(post.body);
  const [busy, setBusy] = useState<'edit' | 'publish' | 'skip' | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const run = async (kind: 'edit' | 'publish' | 'skip') => {
    setBusy(kind); setNote(null);
    const err = kind === 'edit' ? await auto.editPost(post.id, text) : kind === 'publish' ? await auto.publishPost(post.id) : await auto.skipPost(post.id);
    setBusy(null);
    if (err) { setNote({ kind: 'error', text: err }); return; }
    if (kind === 'edit') { setEditing(false); setNote({ kind: 'ok', text: POST.savedEdit }); }
  };
  return (
    <>
      {editing ? (
        <div className="dv3-a-field dv3-a-postedit">
          <div className="dv3-a-field-head">
            <label htmlFor={id}>{POST.editLabel}</label>
            <span className="dv3-a-counter" aria-hidden>{`${text.length} / ${MAX_POST}`}</span>
          </div>
          <textarea id={id} className="dv3-a-input" rows={7} maxLength={MAX_POST} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="dv3-a-actions">
            <button type="button" className="dv3-btn" disabled={busy !== null || !text.trim() || text === post.body} onClick={() => void run('edit')}>{POST.saveEdit}</button>
            <button type="button" className="dv3-btn dv3-btn-ghost" disabled={busy !== null} onClick={() => { setEditing(false); setText(post.body); setNote(null); }}>{POST.cancel}</button>
          </div>
        </div>
      ) : (
        <div className="dv4-post-actions">
          <button type="button" className="dv3-btn dv3-btn-ghost" disabled={busy !== null} onClick={() => { setEditing(true); setNote(null); }}>{POST.edit}</button>
          {/* the one filled button of the card only when the post cannot go out without the owner */}
          <button type="button" className={`dv3-btn ${waits ? '' : 'dv3-btn-ghost'}`} disabled={busy !== null} onClick={() => void run('publish')}>{POST.publish}</button>
          <button type="button" className="dv3-btn dv3-btn-ghost" disabled={busy !== null} aria-label={POST.skipLabel} onClick={() => void run('skip')}>{POST.skip}</button>
        </div>
      )}
      {note && <Notice kind={note.kind}>{note.text}</Notice>}
    </>
  );
}

function PostText({ post }: { post: Post }) {
  const id = useId();
  const [all, setAll] = useState(false);
  // "הצגת הכול" only when the three lines really cut something (it depends on the width).
  const [cut, setCut] = useState(post.body.length > CLAMP_FROM);
  const watch = useCallback((el: HTMLQuoteElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (el.dataset.clamped === 'true') setCut(el.scrollHeight > el.clientHeight + 2); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const long = cut || all;
  return (
    <>
      <blockquote id={id} ref={watch} className="dv4-post-text" data-clamped={!all}>{post.body}</blockquote>
      {long && <button type="button" className="dv3-linkbtn" aria-expanded={all} aria-controls={id} onClick={() => setAll((v) => !v)}>{all ? POST.showLess : POST.showAll}</button>}
    </>
  );
}

export default function NextPostCard({ auto, approved }: { auto: Autopilot; approved: boolean }) {
  const { posts } = auto;
  const a = auto.automation.status === 'ok' ? auto.automation.data : null;
  const list = posts.status === 'ok' ? posts.data : [];
  const next = [...list].filter((p) => p.status === 'scheduled').sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0] ?? null;
  const waits = !!next && a?.postsMode === 'approve' && a.live;
  const noneText = !approved ? POST.noneUnapproved : a?.postsMode === 'off' ? POST.noneOff : POST.none;

  return (
    <section className="dv4-card dv4-post" aria-labelledby="dv3-post">
      <div className="dv4-card-head">
        <h3 id="dv3-post" tabIndex={-1}>{POST.title}</h3>
        {posts.status === 'ok' && <NeedChip kind={waits ? 'approve' : 'none'} />}
      </div>
      {posts.status === 'loading' && <div aria-busy="true" aria-label="טוען"><Skeleton className="h-32 !rounded-[16px]" /></div>}
      {posts.status === 'error' && <LoadError text={POST.error} onRetry={auto.reload} />}
      {posts.status === 'ok' && next && (
        <>
          <p className="dv4-post-when"><strong>{whenLine(next, a)}</strong> <span>{POST.topic(next.topic)}{next.edited ? `. ${POST.edited}.` : ''}</span></p>
          <PostText key={next.id + next.body} post={next} />
          <Actions key={`a${next.id}${next.body}`} post={next} auto={auto} waits={waits} />
        </>
      )}
      {posts.status === 'ok' && !next && <p className="dv4-quiet"><strong>{POST.noneTitle}.</strong> {noneText}</p>}
    </section>
  );
}

/** The posts that already went out, newest first. Lives on the activity screen. */
export function PostHistory({ auto }: { auto: Autopilot }) {
  if (auto.posts.status !== 'ok') return null;
  const history = auto.posts.data.filter((p) => p.status === 'published').sort((x, y) => (y.publishedAt ?? '').localeCompare(x.publishedAt ?? '')).slice(0, 10);
  return (
    <section className="dv4-card" aria-labelledby="dv4-history">
      <div className="dv4-card-head"><h3 id="dv4-history">{POST.history}</h3></div>
      {history.length === 0 ? <p className="dv4-quiet">{POST.historyEmpty}</p> : (
        <ul className="dv4-history">
          {history.map((p) => (
            <li key={p.id}>
              <p><strong>{p.topic}</strong> <time dateTime={p.publishedAt ?? ''}>{POST.publishedAt(relTime(p.publishedAt ?? p.createdAt))}</time></p>
              <p className="dv4-history-text">{p.body}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
