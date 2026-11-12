import { useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { CARD } from '../autopilotCopy';
import { AreasField, Field, MAX_DESCRIPTION, MAX_NOTES, ServicesField, TextArea } from './CardFields';
import { Notice } from './bits';
import { formOf, hoursLines, patchOf, shortDate, type CardForm } from './format';
import type { Autopilot } from './useAutopilot';
import type { Truth } from './types';

// Part 3 of the business card screen: what Google holds (read only), what the customer completes
// here, and the one approval. The parent remounts this with every card that arrives from the
// server (key = truthVersion), so the fields always start from what is saved.

export type CardNotice = { kind: 'ok' | 'error'; text: string } | null;

interface Props {
  truth: Truth;
  auto: Autopilot;
  notice: CardNotice;
  onNotice: (n: CardNotice) => void;
  onSettings: () => void;
}

export default function CardEditor({ truth, auto, notice, onNotice, onSettings }: Props) {
  const { card, readiness } = truth;
  const [form, setForm] = useState<CardForm>(() => formOf(card));
  const [busy, setBusy] = useState<'save' | 'approve' | 'sync' | null>(null);
  const patch = patchOf(card, form);
  const dirty = Object.keys(patch).length > 0;
  const approved = !!truth.approvedAt;
  const live = auto.automation.status === 'ok' ? auto.automation.data.live : null;
  const missing = readiness.checks.filter((c) => c.required && c.state === 'missing');
  const up = <K extends keyof CardForm>(k: K, v: CardForm[K]) => { setForm((f) => ({ ...f, [k]: v })); if (notice) onNotice(null); };

  const run = async (kind: 'save' | 'approve' | 'sync') => {
    setBusy(kind); onNotice(null);
    let err: string | null = null;
    let okText = CARD.saved;
    if (kind === 'sync') { err = await auto.sync(); okText = CARD.syncDone; }
    else {
      if (dirty) err = await auto.save(patch);
      if (!err && kind === 'approve') { err = await auto.approve(); okText = ''; }
    }
    setBusy(null);
    onNotice(err ? { kind: 'error', text: err } : okText ? { kind: 'ok', text: okText } : null);
  };

  const hours = hoursLines(card.hours);
  return (
    <div className="dv3-a-editor">
      <section className="dv3-a-panel" aria-label={CARD.googleTitle}>
        <h4>{CARD.googleTitle}</h4>
        <dl className="dv3-a-dl">
          <div><dt>{CARD.name}</dt><dd>{card.name || CARD.empty}</dd></div>
          <div><dt>{CARD.address}</dt><dd>{card.address || CARD.empty}</dd></div>
          <div><dt>{CARD.category}</dt><dd>{[card.category, ...card.categories].filter(Boolean).join(', ') || CARD.empty}</dd></div>
          <div>
            <dt>{CARD.hours}</dt>
            <dd>
              {hours.length === 0 ? CARD.noHours : (
                <ul className="dv3-a-hours">{hours.map((h) => <li key={h.days}><span>{h.days}</span> <bdi dir="ltr">{h.spans}</bdi></li>)}</ul>
              )}
            </dd>
          </div>
        </dl>
        <p className="dv3-a-hint">{CARD.googleNote} {CARD.hoursNote}</p>
        <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" disabled={busy !== null || auto.syncing} onClick={() => void run('sync')}>
          <RefreshCw size={16} aria-hidden /> {busy === 'sync' ? CARD.syncing : CARD.sync}
        </button>
      </section>

      <form className="dv3-a-panel" aria-label={CARD.editTitle} onSubmit={(e) => { e.preventDefault(); if (dirty && !busy) void run('save'); }}>
        <h4>{CARD.editTitle}</h4>
        <div className="dv3-a-two">
          <Field label={CARD.phone}>
            {({ id }) => <input id={id} className="dv3-a-input" type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={30} value={form.phone} onChange={(e) => up('phone', e.target.value)} />}
          </Field>
          <Field label={CARD.website} hint={CARD.websiteHint}>
            {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} className="dv3-a-input" type="url" dir="ltr" inputMode="url" placeholder="https://" maxLength={300} value={form.website} onChange={(e) => up('website', e.target.value)} />}
          </Field>
        </div>
        <ServicesField value={form.services} onChange={(v) => up('services', v)} />
        <AreasField value={form.areas} onChange={(v) => up('areas', v)} />
        <TextArea label={CARD.description} hint={CARD.descriptionHint} value={form.description} max={MAX_DESCRIPTION} rows={5} onChange={(v) => up('description', v)} />
        <TextArea label={CARD.notes} hint={CARD.notesHint} value={form.notes} max={MAX_NOTES} rows={4} onChange={(v) => up('notes', v)} />
        <div className="dv3-a-actions">
          <button type="submit" className={`dv3-btn ${approved ? '' : 'dv3-btn-ghost'}`} disabled={!dirty || busy !== null}>{busy === 'save' ? CARD.saving : CARD.save}</button>
        </div>
      </form>

      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}

      {approved ? (
        <section className="dv3-a-approved" aria-label={CARD.approvedTitle}>
          <Notice kind="ok">{CARD.approvedOn(shortDate(truth.approvedAt!))}</Notice>
          {live !== null && (
            <div className="dv3-a-next">
              <h4>{CARD.nextTitle}</h4>
              <ul>{(live ? CARD.nextLive : CARD.nextNotLive).map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          )}
          <button type="button" className="dv3-btn dv3-btn-ghost" onClick={onSettings}>{CARD.toSettings} <ArrowLeft size={16} aria-hidden /></button>
        </section>
      ) : (
        <section className="dv3-a-approve" aria-label={CARD.approve}>
          <div className="dv3-a-consent" id="dv3-consent">
            <p><strong>{CARD.consentLead}</strong></p>
            <ul>{CARD.consent.map((t) => <li key={t}>{t}</li>)}</ul>
            <p>{CARD.consentEnd}<button type="button" className="dv3-a-inlinelink" onClick={onSettings}>{CARD.consentLink}</button>.</p>
          </div>
          {!readiness.ready && (
            <p className="dv3-a-blocked" id="dv3-approve-why">{CARD.notReadyWhy} {missing.map((c) => c.title).join(', ')}.</p>
          )}
          <button
            type="button" className="dv3-btn dv3-a-approvebtn" disabled={!readiness.ready || busy !== null}
            aria-describedby={readiness.ready ? 'dv3-consent' : 'dv3-approve-why dv3-consent'} onClick={() => void run('approve')}
          >
            {busy === 'approve' ? CARD.approving : CARD.approve} <ArrowLeft size={16} aria-hidden />
          </button>
        </section>
      )}
    </div>
  );
}
