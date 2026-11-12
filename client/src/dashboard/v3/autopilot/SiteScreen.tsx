import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, ChevronLeft, ExternalLink, FileText, Info, Search } from 'lucide-react';
import type { IncludedPage } from '../../shell/bridge';
import { Skeleton } from '../../ui';
import { ViewShell } from '../Views';
import { RETRY, SITE } from '../autopilotCopy';
import { Notice, SampleBanner } from './bits';
import { samplePage } from './sample';
import { isApproved } from './mode';
import type { Autopilot } from './useAutopilot';
import type { PhraseIdea, PhrasePage, Phrases } from './types';

// "הדף והחיפושים שלכם": the landing page that comes with the promotion subscription (one state,
// one action), and under it the search-phrase pages. A promotion customer has pages without having
// bought the pages product, so this screen never mentions page credits.

type PageState = 'none' | 'busy' | 'draft' | 'published' | 'frozen' | 'other';

interface Props {
  auto: Autopilot;
  /** the included page as the account's page list knows it; null = none */
  page: IncludedPage | null;
  onBusiness: () => void;
  onPlan: () => void;
  /** promotion only: the quiet way to more pages */
  morePagesLink: boolean;
}

type Included = 'yes' | 'no' | 'wait' | 'error';

/** The landing page that comes with the subscription: one state, one action. Also shown at the end of the short setup. */
export function IncludedCard({ auto, page, onBusiness, onPlan }: Omit<Props, 'morePagesLink'>) {
  const st = auto.landing;
  const pub = auto.publish;
  // A page created (or found) a moment ago wins over what the page list knew when it loaded.
  const base = st.phase === 'done' ? { id: st.page.id, slug: st.page.slug, status: st.page.status as string, url: '' } : page;
  // ...and a page published from here a moment ago is live, whatever the list still says.
  const justPublished = pub.phase === 'done' && !!base && pub.id === base.id;
  const cur = base && pub.phase === 'done' && pub.id === base.id ? { ...base, slug: pub.slug, status: 'published', url: pub.url } : base;
  const known = (s: string): PageState => (s === 'draft' || s === 'published' || s === 'frozen' ? s : 'other');
  const state: PageState = st.phase === 'busy' ? 'busy' : !cur ? 'none' : known(cur.status);
  const approved = isApproved(auto);
  const ready = auto.truth.status === 'ok' && !!auto.truth.data?.readiness.ready;
  const blocked = !approved ? SITE.needApproval : !ready ? SITE.needDetails : null;
  const draftHref = cur ? `/p/${encodeURIComponent(cur.slug)}` : '#';
  const liveHref = cur && cur.url ? cur.url : draftHref;

  // A draft is "included" only when the server says so: the subscription's one page may already be another page.
  const draftId = state === 'draft' && cur?.id ? cur.id : null;
  const [checked, setChecked] = useState<{ id: string; v: 'yes' | 'no' | 'error' } | null>(null);
  const [again, setAgain] = useState(0);
  const { checkIncluded } = auto;
  useEffect(() => {
    if (!draftId) return;
    let off = false;
    checkIncluded(draftId).then(
      (v) => { if (!off) setChecked({ id: draftId, v: v ? 'yes' : 'no' }); },
      () => { if (!off) setChecked({ id: draftId, v: 'error' }); },
    );
    return () => { off = true; };
  }, [draftId, checkIncluded, again]);
  const mine = !!draftId && pub.phase !== 'idle' && pub.id === draftId;
  const needsPayment = mine && pub.phase === 'payment';
  const included: Included = !draftId ? 'yes' : needsPayment ? 'no' : checked?.id === draftId ? checked.v : 'wait';
  const publishing = mine && pub.phase === 'busy';

  const title = { none: SITE.noneTitle, busy: SITE.busyTitle, draft: SITE.draftTitle, published: SITE.liveTitle, frozen: SITE.frozenTitle, other: SITE.otherTitle }[state];
  const draftBody = included === 'yes' || included === 'wait' ? SITE.draftBodyIncluded : SITE.draftBodyNotIncluded;
  const body = { none: SITE.noneBody, busy: SITE.busyBody, draft: draftBody, published: SITE.liveBody, frozen: SITE.frozenBody, other: '' }[state];

  const open = (href: string, label: string) => (auto.preview
    ? <p className="dv4-quiet">{SITE.sampleLink}</p>
    : (
      <a className="dv3-btn" href={href} target="_blank" rel="noopener noreferrer">
        {label} <ExternalLink size={16} aria-hidden /><span className="sr-only"> {SITE.newTab}</span>
      </a>
    ));
  const second = (href: string, label: string) => (auto.preview
    ? <p className="dv4-quiet">{SITE.sampleLink}</p>
    : (
      <a className="dv4-page-second" href={href} target="_blank" rel="noopener noreferrer">
        {label} <ExternalLink size={14} aria-hidden /><span className="sr-only"> {SITE.newTab}</span>
      </a>
    ));

  return (
    <section className="dv4-card dv4-page" data-state={state} aria-labelledby="dv4-page">
      <div className="dv4-card-head">
        <h3 id="dv4-page"><span className="dv4-icon" aria-hidden><FileText size={20} /></span>{SITE.pageTitle}</h3>
        {included === 'yes' && <span className="dv4-tag">{SITE.included}</span>}
      </div>
      <div className="dv4-page-body" aria-live="polite">
        <div className="dv4-page-text">
          <p className="dv4-page-state">
            {state === 'busy' && <span className="dv3-a-spinner" aria-hidden />}
            {state === 'published' && <span className="dv4-pulse dv4-pulse-ok" aria-hidden />}
            {title}
          </p>
          {body && <p>{body}</p>}
          {state === 'published' && cur?.url && <p className="dv4-url" dir="ltr">{cur.url.replace(/^https?:\/\//, '')}</p>}
        </div>
        <div className="dv4-page-action">
          {state === 'none' && (
            <>
              <button type="button" className="dv3-btn" disabled={!!blocked} aria-describedby={blocked ? 'dv4-page-why' : undefined} onClick={auto.createLanding}>{SITE.create}</button>
              {blocked && (
                <p id="dv4-page-why" className="dv4-quiet">
                  {blocked} <button type="button" className="dv3-a-inlinelink" onClick={onBusiness}>{SITE.toBusiness}</button>
                </p>
              )}
            </>
          )}
          {state === 'draft' && (included === 'yes' || included === 'wait') && (
            <>
              <button type="button" className="dv3-btn" disabled={included === 'wait' || publishing} aria-busy={included === 'wait' || publishing} onClick={() => draftId && auto.publishPage(draftId)}>
                {publishing ? SITE.publishing : SITE.publish}
              </button>
              {second(draftHref, SITE.openDraft)}
            </>
          )}
          {state === 'draft' && included === 'error' && open(draftHref, SITE.openDraft)}
          {state === 'draft' && included === 'no' && open(draftHref, needsPayment ? SITE.toPage : SITE.openDraft)}
          {(state === 'published' || state === 'other') && open(liveHref, SITE.openLive)}
          {state === 'frozen' && <button type="button" className="dv3-btn" onClick={onPlan}>{SITE.toPlan} <ArrowLeft size={16} aria-hidden /></button>}
        </div>
      </div>
      <div aria-live="polite" className="dv4-live">
        {publishing && (
          <div className="dv4-progress" role="status">
            <p>{SITE.publishingNote}</p>
            <span className="dv4-progress-bar" aria-hidden><span /></span>
          </div>
        )}
        {justPublished && <Notice kind="ok">{SITE.published} <span dir="ltr">{pub.phase === 'done' ? pub.url.replace(/^https?:\/\//, '') : ''}</span>{auto.preview ? ` ${SITE.samplePublished}` : ''}</Notice>}
        {needsPayment && pub.phase === 'payment' && <Notice kind="error">{pub.error} {SITE.paymentNote}</Notice>}
        {mine && pub.phase === 'error' && <Notice kind="error">{pub.error}</Notice>}
      </div>
      {st.phase === 'error' && <Notice kind="error">{st.error}</Notice>}
      {included === 'yes' && <p className="dv4-included"><Check size={16} strokeWidth={3} aria-hidden />{SITE.includedLine}</p>}
      {included === 'no' && !needsPayment && <p className="dv4-included" data-kind="no"><Info size={16} aria-hidden />{SITE.notIncludedLine}</p>}
      {included === 'wait' && <p className="dv4-included" data-kind="wait">{SITE.checking}</p>}
      {included === 'error' && (
        <p className="dv4-included" data-kind="no">
          <span>{SITE.includedUnknown} <button type="button" className="dv3-a-inlinelink" onClick={() => { setChecked(null); setAgain((n) => n + 1); }}>{RETRY}</button></span>
        </p>
      )}
    </section>
  );
}

function PhraseRow({ page, published }: { page: PhrasePage; published: boolean }) {
  const name = page.title || page.phrase || '';
  return (
    <li>
      <span className="dv4-icon dv4-icon-sm" aria-hidden><Search size={16} /></span>
      <span className="dv4-phrase-name">{name}</span>
      {published && page.url
        ? <a className="dv4-rowlink" href={page.url} target="_blank" rel="noopener noreferrer">{SITE.view}<span className="sr-only"> {name} {SITE.newTab}</span> <ExternalLink size={14} aria-hidden /></a>
        : <span className="dv4-tag dv4-tag-quiet">{published ? SITE.live : SITE.waitsForParent}</span>}
    </li>
  );
}

function PhrasesBlock({ auto, data }: { auto: Autopilot; data: Phrases }) {
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const busy = auto.phraseBusy;
  const create = async (idea: PhraseIdea) => {
    setNote(null);
    const err = await auto.createPhrase(idea.phrase);
    if (err === false) return;
    setNote(err ? { kind: 'error', text: err } : { kind: 'ok', text: `${SITE.created(idea.phrase)}${data.parentPublished ? '' : ` ${SITE.createdWaits}`}` });
  };

  if (!data.hasPage) return <div className="dv4-empty"><strong>{SITE.phrasesNoPage}</strong></div>;
  const canCreate = data.left > 0;
  return (
    <>
      <div>
        <h4>{SITE.existing}</h4>
        {data.pages.length === 0 ? <p className="dv4-quiet">{SITE.noPagesYet}</p> : (
          <ul className="dv4-phrases">{data.pages.map((p) => <PhraseRow key={p.id} page={p} published={data.parentPublished} />)}</ul>
        )}
      </div>
      <div>
        <h4>{SITE.ideas}</h4>
        {!canCreate ? <p className="dv4-quiet">{SITE.limit}</p> : data.ideas.length === 0 ? <p className="dv4-quiet">{SITE.noIdeas}</p> : (
          <>
            <ul className="dv4-phrases">
              {data.ideas.map((i) => (
                <li key={i.phrase} data-busy={busy === i.phrase}>
                  <span className="dv4-phrase-name">{i.phrase}<small>{SITE.ideaFor(i.service, i.area)}</small></span>
                  <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" disabled={busy !== null} onClick={() => void create(i)}>
                    {busy === i.phrase ? SITE.creating : SITE.createPhrase}<span className="sr-only"> {i.phrase}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="dv4-fine">{SITE.left(data.left)}</p>
          </>
        )}
      </div>
      <div aria-live="polite" className="dv4-live">
        {busy && (
          <div className="dv4-progress" role="status">
            <p>{SITE.creatingNote(busy)}</p>
            <span className="dv4-progress-bar" aria-hidden><span /></span>
          </div>
        )}
        {!busy && note && <Notice kind={note.kind}>{note.text}</Notice>}
      </div>
    </>
  );
}

export default function SiteScreen({ auto, page, onBusiness, onPlan, morePagesLink }: Props) {
  const { phrases, loadPhrases } = auto;
  // Read when the screen opens (and again after a landing page was created): not with every dashboard load.
  useEffect(() => {
    if (phrases === null) loadPhrases();
  }, [phrases, loadPhrases]);

  // The preview never shows a real page: its page is the sample's (?page=draft|live|frozen).
  const sample = auto.preview ? samplePage() : null;
  const shown: IncludedPage | null = auto.preview ? (sample ? { id: sample.id, slug: sample.slug, status: sample.status, url: 'https://pagey.co.il/p/sample-page' } : null) : page;

  return (
    <ViewShell title={SITE.title} hint={SITE.hint}>
      {auto.preview && <SampleBanner />}
      <IncludedCard auto={auto} page={shown} onBusiness={onBusiness} onPlan={onPlan} />

      <section className="dv4-card dv4-phrasecard" aria-labelledby="dv4-phrases">
        <div className="dv4-card-head"><h3 id="dv4-phrases">{SITE.phrasesTitle}</h3></div>
        <p className="dv4-lead">{SITE.phrasesWhy}</p>
        {(!phrases || phrases.status === 'loading') && <div className="flex flex-col gap-2" aria-busy="true" aria-label="טוען"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
        {phrases?.status === 'error' && (
          <div className="dv3-a-msg dv3-a-msg-error" role="alert">
            <p>{SITE.phrasesError} {phrases.error}</p>
            <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={loadPhrases}>{RETRY}</button>
          </div>
        )}
        {phrases?.status === 'ok' && <PhrasesBlock auto={auto} data={phrases.data} />}
      </section>

      {morePagesLink && (
        <Link to="/create" className="dv4-softlink">
          <span><strong>{SITE.morePages}</strong><small>{SITE.morePagesSub}</small></span>
          <ChevronLeft size={18} aria-hidden />
        </Link>
      )}
    </ViewShell>
  );
}
