import { useId, useState, type ReactNode } from 'react';
import { Check, Copy, MessageCircle, QrCode } from 'lucide-react';
import QrModal from '../../../components/QrModal';
import { requestTextOpen, waShare } from '../../../lib/reviewRequestMsg';
import { Skeleton } from '../../ui';
import { KIT } from '../autopilotCopy';
import { LoadError } from './bits';
import type { Autopilot } from './useAutopilot';

// "בקשו ביקורות": the three ready things an owner needs to ask a customer for a review. The link is
// Google's own (truth.card.reviewUrl, read from the listing). We give the tools; only the owner can ask.
// `personal` is the kit's second part: the request to one customer by name and phone (ReviewRequestsCard,
// embedded), which used to be a card of its own further down the screen.

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch { /* clipboard blocked: the text is visible and can be selected */ }
  };
  return (
    <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={() => void copy()}>
      {done ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      <span aria-live="polite">{done ? KIT.copied : label}</span>
    </button>
  );
}

export default function ReviewKit({ auto, onBusiness, personal }: { auto: Autopilot; onBusiness: () => void; personal?: ReactNode }) {
  const linkId = useId();
  const msgId = useId();
  const [qr, setQr] = useState(false);
  const { truth } = auto;
  const card = truth.status === 'ok' ? truth.data?.card ?? null : null;
  const link = card?.reviewUrl?.trim() ?? '';
  const text = card && link ? requestTextOpen(card.name, link) : '';

  return (
    <section className="dv4-card dv4-kit" aria-labelledby="dv4-kit">
      <div className="dv4-card-head"><h3 id="dv4-kit">{KIT.title}</h3></div>
      <p className="dv4-lead">{KIT.why}</p>
      {truth.status === 'loading' && <div aria-busy="true" aria-label="טוען"><Skeleton className="h-24 !rounded-[16px]" /></div>}
      {truth.status === 'error' && <LoadError text={KIT.error} onRetry={auto.reload} />}
      {truth.status === 'ok' && !link && (
        <p className="dv4-quiet">
          {KIT.noLink} <button type="button" className="dv3-a-inlinelink" onClick={onBusiness}>{KIT.toBusiness}</button>
        </p>
      )}
      {truth.status === 'ok' && link && (
        <>
          <h4 className="dv4-kit-sub">{KIT.readyTitle}</h4>
          <div className="dv4-kit-grid">
            <div className="dv4-kit-part">
              <label htmlFor={linkId}>{KIT.linkLabel}</label>
              <input id={linkId} className="dv3-a-input" readOnly dir="ltr" value={link} onFocus={(e) => e.currentTarget.select()} />
              <div className="dv4-kit-actions">
                <CopyButton text={link} label={KIT.copyLink} />
                <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={() => setQr(true)}><QrCode size={16} aria-hidden />{KIT.qr}</button>
              </div>
            </div>
            <div className="dv4-kit-part">
              <label htmlFor={msgId}>{KIT.msgLabel}</label>
              <textarea id={msgId} className="dv3-a-input" readOnly rows={3} value={text} onFocus={(e) => e.currentTarget.select()} />
              <div className="dv4-kit-actions">
                <a className="dv3-btn dv3-a-small" href={waShare(text)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={16} aria-hidden />{KIT.send}<span className="sr-only"> {KIT.newTab}</span>
                </a>
                <CopyButton text={text} label={KIT.copyMsg} />
              </div>
            </div>
          </div>
          <p className="dv4-fine">{KIT.fair}</p>
          {qr && <QrModal url={link} title={KIT.qrTitle(card?.name ?? '')} onClose={() => setQr(false)} />}
        </>
      )}
      {truth.status === 'ok' && personal}
    </section>
  );
}
