import { ExternalLink, FileText } from 'lucide-react';
import { NeedChip } from '../parts';
import { LANDING } from '../autopilotCopy';
import { Notice } from './bits';
import type { Autopilot } from './useAutopilot';

// "צרו לי דף נחיתה": one press, and the server writes a whole landing page from the business details
// (about a minute). The page is always a draft: publishing, and paying for it, happen on the page
// itself. The link is the one the "my pages" list uses (/p/:slug, which shows the owner the draft).

interface Props {
  auto: Autopilot;
  /** false while required details are missing: the server would refuse, so the button waits */
  ready?: boolean;
}

export default function LandingPageCard({ auto, ready = true }: Props) {
  const st = auto.landing;
  const busy = st.phase === 'busy';
  const page = st.phase === 'done' ? st.page : null;
  return (
    <section className="dv3-block dv3-a-post dv3-a-landing" aria-labelledby="dv3-landing">
      <div className="dv3-a-posthead">
        <span className="dv3-row-icon" aria-hidden><FileText size={20} /></span>
        <h3 id="dv3-landing">{LANDING.title}</h3>
      </div>
      <div className="dv3-trio">
        <div className="dv3-cell dv3-c1" data-h="מה צריך לעשות"><p>{LANDING.what}</p></div>
        <div className="dv3-cell dv3-c2" data-h="איך אנחנו עושים את זה">
          <p>{LANDING.how}</p>
          <p className="dv3-a-landing-honest">{LANDING.honest}</p>
        </div>
        <div className="dv3-cell dv3-c3" data-h="מה אתם צריכים לעשות">
          <NeedChip kind={page || busy ? 'none' : 'one'} />
          {!page && !busy && <p>{LANDING.you}</p>}
          {!page && (
            <button
              type="button" className="dv3-btn dv3-a-landingbtn" disabled={busy || !ready}
              aria-describedby={!ready ? 'dv3-landing-why' : undefined} onClick={auto.createLanding}
            >
              {busy ? LANDING.busyCta : LANDING.cta}
            </button>
          )}
          {!page && !ready && <p id="dv3-landing-why" className="dv3-a-hint">{LANDING.notReady}</p>}
          <div className="dv3-a-landing-live" aria-live="polite">
            {busy && (
              <div className="dv3-a-landing-busy">
                <span className="dv3-a-spinner" aria-hidden />
                <p><strong>{LANDING.busy}</strong> {LANDING.busySub}</p>
              </div>
            )}
            {st.phase === 'error' && <Notice kind="error">{st.error}</Notice>}
            {page && (
              <>
                <Notice kind={page.existing ? 'info' : 'ok'}>
                  {page.existing
                    ? <><strong>{LANDING.existing}.</strong> {LANDING.existingStatus(LANDING.status[page.status] ?? LANDING.statusOther)}</>
                    : <><strong>{LANDING.done}</strong> {LANDING.doneSub}</>}
                </Notice>
                {auto.preview ? <p className="dv3-a-hint">{LANDING.sampleLink}</p> : (
                  <a className="dv3-btn dv3-a-landingbtn" href={`/p/${encodeURIComponent(page.slug)}`} target="_blank" rel="noopener noreferrer">
                    {page.existing ? LANDING.openExisting : LANDING.open} <ExternalLink size={16} aria-hidden />
                    <span className="sr-only"> {LANDING.newTab}</span>
                  </a>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
