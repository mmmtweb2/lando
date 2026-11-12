import { useId, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Skeleton } from '../../ui';
import { NeedChip } from '../parts';
import { POST } from '../autopilotCopy';
import { LoadError, Notice } from './bits';
import { dayAndHour, relTime } from './format';
import type { Autopilot } from './useAutopilot';
import type { Automation, Post } from './types';

// "הפוסט הבא": this week's post in the three fixed parts (what / how we do it / what you do), with
// edit, publish now and skip. Under it, the posts that were already published.

const MAX_POST = 1500;

function whenLine(p: Post, a: Automation | null): string {
  if (p.problem === 'quota_pending') return POST.whenQuota;
  if (p.problem === 'failed') return POST.whenFailed;
  if (a && !a.live) return POST.whenNotLive;
  if (a?.postsMode === 'approve') return POST.whenApprove;
  if (a?.postsMode === 'off') return POST.whenOff;
  return new Date(p.publishAfter).getTime() <= Date.now() ? POST.whenSoon : POST.whenAuto(dayAndHour(p.publishAfter));
}

function Actions({ post, auto }: { post: Post; auto: Autopilot }) {
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
        <div className="dv3-a-actions">
          <button type="button" className="dv3-btn" disabled={busy !== null} onClick={() => void run('publish')}>{POST.publish}</button>
          <button type="button" className="dv3-btn dv3-btn-ghost" disabled={busy !== null} onClick={() => { setEditing(true); setNote(null); }}>{POST.edit}</button>
          <button type="button" className="dv3-btn dv3-btn-ghost" disabled={busy !== null} onClick={() => void run('skip')}>{POST.skip}</button>
        </div>
      )}
      {note && <Notice kind={note.kind}>{note.text}</Notice>}
    </>
  );
}

export default function NextPostCard({ auto, approved }: { auto: Autopilot; approved: boolean }) {
  const { posts } = auto;
  const a = auto.automation.status === 'ok' ? auto.automation.data : null;
  const list = posts.status === 'ok' ? posts.data : [];
  const next = [...list].filter((p) => p.status === 'scheduled').sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0] ?? null;
  const history = list.filter((p) => p.status === 'published').sort((x, y) => (y.publishedAt ?? '').localeCompare(x.publishedAt ?? '')).slice(0, 5);
  const waits = !!next && a?.postsMode === 'approve' && a.live;
  const noneText = !approved ? POST.noneUnapproved : a?.postsMode === 'off' ? POST.noneOff : POST.none;

  return (
    <section className="dv3-block dv3-a-post" aria-labelledby="dv3-post">
      <div className="dv3-a-posthead">
        <span className="dv3-row-icon" aria-hidden><Megaphone size={20} /></span>
        <h3 id="dv3-post" tabIndex={-1}>{POST.title}</h3>
        {next && <span className="dv3-state">{POST.topic(next.topic)}</span>}
      </div>
      {posts.status === 'loading' && <div aria-busy="true" aria-label="טוען"><Skeleton className="h-40 !rounded-[16px]" /></div>}
      {posts.status === 'error' && <LoadError text={POST.error} onRetry={auto.reload} />}
      {posts.status === 'ok' && (
        <div className="dv3-trio">
          <div className="dv3-cell dv3-c1" data-h="מה צריך לעשות"><p>{POST.what}</p></div>
          <div className="dv3-cell dv3-c2" data-h="איך אנחנו עושים את זה">
            {next ? (
              <>
                <p>{POST.how}</p>
                <blockquote className="dv3-a-posttext">{next.body}</blockquote>
                {next.edited && <p className="dv3-a-hint">{POST.edited}</p>}
              </>
            ) : <p>{POST.howNone}</p>}
          </div>
          <div className="dv3-cell dv3-c3" data-h="מה אתם צריכים לעשות">
            <NeedChip kind={waits ? 'approve' : 'none'} />
            {next ? (
              <>
                <p className="dv3-a-when">{whenLine(next, a)}</p>
                <p>{waits ? POST.youApprove : POST.youAuto}</p>
                <Actions key={next.id + next.body} post={next} auto={auto} />
              </>
            ) : (
              <>
                <p>{POST.youNone}</p>
                <p className="dv3-a-hint"><strong>{POST.noneTitle}.</strong> {noneText}</p>
              </>
            )}
          </div>
        </div>
      )}
      {posts.status === 'ok' && approved && (
        <div className="dv3-a-history">
          <h4>{POST.history}</h4>
          {history.length === 0 ? <p className="dv3-a-hint">{POST.historyEmpty}</p> : (
            <ul>
              {history.map((p) => (
                <li key={p.id}>
                  <p><strong>{p.topic}</strong> <time dateTime={p.publishedAt ?? ''}>{POST.publishedAt(relTime(p.publishedAt ?? p.createdAt))}</time></p>
                  <p className="dv3-a-history-text">{p.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
