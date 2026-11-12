import { useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, Check, Minus, RefreshCw } from 'lucide-react';
import { CARD, STEPS } from '../autopilotCopy';
import { AreasField, Field, MAX_DESCRIPTION, MAX_NOTES, ServicesField, TextArea } from './CardFields';
import { Notice } from './bits';
import { formOf, hoursLines, patchOf, shortDate, type CardForm } from './format';
import type { Autopilot } from './useAutopilot';
import type { CheckState, ReadinessCheck, Truth } from './types';

// "פרטי העסק" in three steps instead of one long form (docs/dashboard-v4-spec.md, part E):
//   1. what we found   – only the weak and missing items are spelled out; the full ones are one line
//   2. fill in the gaps – the fields that are missing or thin first; the rest behind "עריכת כל הפרטים"
//   3. the approval     – a short consent (three lines, the rest behind "פירוט")
// Same calls as before: save sends only what changed, approve saves first when something changed.
// The parent remounts this with every card that arrives from the server (key = truthVersion), so
// the fields always start from what is saved; the step itself is kept by the parent.

export type CardNotice = { kind: 'ok' | 'error'; text: string } | null;
export type Step = 1 | 2 | 3;

interface Props {
  truth: Truth;
  auto: Autopilot;
  step: Step;
  onStep: (s: Step) => void;
  notice: CardNotice;
  onNotice: (n: CardNotice) => void;
  onSettings: () => void;
}

type FieldKey = 'phone' | 'website' | 'services' | 'areas' | 'description' | 'notes';
const FIELDS: FieldKey[] = ['phone', 'website', 'services', 'areas', 'description', 'notes'];
const isField = (k: string): k is FieldKey => (FIELDS as string[]).includes(k);
const MARK: Record<CheckState, typeof Check> = { ok: Check, weak: Minus, missing: AlertTriangle };

function Stepper({ step, onStep, done }: { step: Step; onStep: (s: Step) => void; done: boolean }) {
  return (
    <nav aria-label={STEPS.label}>
      <ol className="dv4-steps">
        {STEPS.names.map((name, i) => {
          const n = (i + 1) as Step;
          const state = n === step ? 'current' : n < step || done ? 'done' : 'todo';
          return (
            <li key={name} data-state={state}>
              <button type="button" aria-current={n === step ? 'step' : undefined} onClick={() => onStep(n)}>
                <span className="dv4-step-n" aria-hidden>{state === 'done' ? <Check size={14} strokeWidth={3} /> : n}</span>
                <span>{name}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function CheckItem({ c }: { c: ReadinessCheck }) {
  const Icon = MARK[c.state] ?? Minus;
  return (
    <li data-state={c.state}>
      <span className="dv3-a-check-mark" aria-hidden><Icon size={15} strokeWidth={3} /></span>
      <div>
        <p className="dv3-a-check-title">
          <span>{c.title}</span>
          <span className="dv3-a-check-state">{CARD.state[c.state] ?? ''}</span>
          {c.required && c.state === 'missing' && <span className="dv3-a-check-req">{CARD.required}</span>}
        </p>
        <p className="dv3-a-check-why">{c.why}</p>
      </div>
    </li>
  );
}

export default function CardSteps({ truth, auto, step, onStep, notice, onNotice, onSettings }: Props) {
  const { card, readiness } = truth;
  const [form, setForm] = useState<CardForm>(() => formOf(card));
  const [busy, setBusy] = useState<'save' | 'approve' | 'sync' | null>(null);
  const patch = patchOf(card, form);
  const dirty = Object.keys(patch).length > 0;
  const approved = !!truth.approvedAt;
  const live = auto.automation.status === 'ok' ? auto.automation.data.live : null;
  const open = readiness.checks.filter((c) => c.state !== 'ok');
  const ok = readiness.checks.filter((c) => c.state === 'ok');
  const missing = readiness.checks.filter((c) => c.required && c.state === 'missing');
  const up = <K extends keyof CardForm>(k: K, v: CardForm[K]) => { setForm((f) => ({ ...f, [k]: v })); if (notice) onNotice(null); };

  const run = async (kind: 'save' | 'approve' | 'sync', then?: Step) => {
    setBusy(kind); onNotice(null);
    let err: string | null = null;
    let okText = CARD.saved;
    if (kind === 'sync') { err = await auto.sync(); okText = CARD.syncDone; }
    else {
      if (dirty) err = await auto.save(patch); else okText = '';
      if (!err && kind === 'approve') { err = await auto.approve(); okText = ''; }
    }
    setBusy(null);
    onNotice(err ? { kind: 'error', text: err } : okText ? { kind: 'ok', text: okText } : null);
    if (!err && then) onStep(then);
  };

  const field = (k: FieldKey): ReactNode => {
    switch (k) {
      case 'phone': return (
        <Field key={k} label={CARD.phone}>
          {({ id }) => <input id={id} className="dv3-a-input" type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={30} value={form.phone} onChange={(e) => up('phone', e.target.value)} />}
        </Field>
      );
      case 'website': return (
        <Field key={k} label={CARD.website} hint={CARD.websiteHint}>
          {({ id, describedBy }) => <input id={id} aria-describedby={describedBy} className="dv3-a-input" type="url" dir="ltr" inputMode="url" placeholder="https://" maxLength={300} value={form.website} onChange={(e) => up('website', e.target.value)} />}
        </Field>
      );
      case 'services': return <ServicesField key={k} value={form.services} onChange={(v) => up('services', v)} />;
      case 'areas': return <AreasField key={k} value={form.areas} onChange={(v) => up('areas', v)} />;
      case 'description': return <TextArea key={k} label={CARD.description} hint={CARD.descriptionHint} value={form.description} max={MAX_DESCRIPTION} rows={5} onChange={(v) => up('description', v)} />;
      default: return <TextArea key={k} label={CARD.notes} hint={CARD.notesHint} value={form.notes} max={MAX_NOTES} rows={4} onChange={(v) => up('notes', v)} />;
    }
  };
  const first = FIELDS.filter((k) => open.some((c) => c.key === k));
  const rest = FIELDS.filter((k) => !first.includes(k));
  const inGoogle = open.filter((c) => !isField(c.key));
  const hours = hoursLines(card.hours);

  const syncBtn = (
    <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" disabled={busy !== null || auto.syncing} onClick={() => void run('sync')}>
      <RefreshCw size={16} aria-hidden /> {busy === 'sync' ? CARD.syncing : CARD.sync}
    </button>
  );
  const google = (
    <details className="dv4-fold">
      <summary>{CARD.googleTitle}</summary>
      <div className="dv4-fold-body">
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
        {syncBtn}
      </div>
    </details>
  );

  return (
    <div className="dv4-stepsbox">
      <Stepper step={step} onStep={onStep} done={approved} />

      {step === 1 && (
        <section className="dv4-card" aria-labelledby="dv4-s1">
          <div className="dv4-card-head">
            <h3 id="dv4-s1">{STEPS.names[0]}</h3>
            <strong className="dv4-count">{CARD.readinessCount(readiness.done, readiness.total)}</strong>
          </div>
          <p className="dv4-lead">{open.length === 0 ? STEPS.foundAllOk : STEPS.foundLead}</p>
          {open.length > 0 && <ul className="dv3-a-checks">{open.map((c) => <CheckItem key={c.key} c={c} />)}</ul>}
          {ok.length > 0 && (
            <p className="dv4-okline">
              <span className="dv4-calm-mark" aria-hidden><Check size={14} strokeWidth={3} /></span>
              <span><strong>{STEPS.okLine(ok.length)}</strong> {ok.map((c) => c.title).join(', ')}.</span>
            </p>
          )}
          {google}
          {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
          <div className="dv4-stepnav">
            <button type="button" className="dv3-btn" onClick={() => onStep(open.length > 0 ? 2 : 3)}>{open.length > 0 ? STEPS.toFix : STEPS.toApprove} <ArrowLeft size={16} aria-hidden /></button>
          </div>
        </section>
      )}

      {step === 2 && (
        <form className="dv4-card" aria-labelledby="dv4-s2" onSubmit={(e) => { e.preventDefault(); if (!busy) void run('save', approved ? undefined : 3); }}>
          <div className="dv4-card-head"><h3 id="dv4-s2">{STEPS.names[1]}</h3></div>
          <p className="dv4-lead">{first.length > 0 || inGoogle.length > 0 ? STEPS.fixLead : STEPS.fixNone}</p>
          {first.length > 0 && <div className="dv4-fields">{first.map(field)}</div>}
          {inGoogle.length > 0 && (
            <div className="dv4-ingoogle">
              <p><strong>{STEPS.inGoogle}</strong> {inGoogle.map((c) => c.title).join(', ')}. {STEPS.inGoogleAfter}</p>
              {syncBtn}
            </div>
          )}
          <details className="dv4-fold" open={first.length === 0 && inGoogle.length === 0 ? true : undefined}>
            <summary>{STEPS.allFields}</summary>
            <div className="dv4-fold-body dv4-fields">{rest.map(field)}</div>
          </details>
          {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
          <div className="dv4-stepnav">
            <button type="submit" className="dv3-btn" disabled={busy !== null || (approved && !dirty)}>
              {busy === 'save' ? CARD.saving : approved ? CARD.save : STEPS.saveNext} {!approved && <ArrowLeft size={16} aria-hidden />}
            </button>
            <button type="button" className="dv3-btn dv3-btn-ghost" onClick={() => onStep(1)}>{STEPS.back}</button>
          </div>
        </form>
      )}

      {step === 3 && (
        <section className="dv4-card" aria-labelledby="dv4-s3">
          <div className="dv4-card-head"><h3 id="dv4-s3">{approved ? CARD.approvedTitle : STEPS.names[2]}</h3></div>
          {approved ? (
            <>
              <Notice kind="ok">{CARD.approvedOn(shortDate(truth.approvedAt!))}</Notice>
              {live !== null && (
                <div>
                  <h4>{CARD.nextTitle}</h4>
                  <ul className="dv4-bullets">{(live ? CARD.nextLive : CARD.nextNotLive).map((t) => <li key={t}>{t}</li>)}</ul>
                </div>
              )}
              <div className="dv4-stepnav">
                <button type="button" className="dv3-btn dv3-btn-ghost" onClick={onSettings}>{CARD.toSettings} <ArrowLeft size={16} aria-hidden /></button>
              </div>
            </>
          ) : (
            <>
              <p className="dv4-lead"><strong>{card.name}</strong>. {STEPS.summary(form.services.filter((s) => s.name.trim()).length, form.areas.length)} {STEPS.approveLead}</p>
              <div className="dv4-consent" id="dv3-consent">
                <p><strong>{CARD.consentShortLead}</strong></p>
                <ul className="dv4-bullets">{CARD.consentShort.map((t) => <li key={t}>{t}</li>)}</ul>
                <button type="button" className="dv3-a-inlinelink" aria-label={CARD.consentMoreLabel} onClick={onSettings}>{CARD.consentMore}</button>
              </div>
              {dirty && <p className="dv4-quiet">{STEPS.unsaved}</p>}
              {!readiness.ready && <p className="dv3-a-blocked" id="dv3-approve-why">{CARD.notReadyWhy} {missing.map((c) => c.title).join(', ')}.</p>}
              {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
              <div className="dv4-stepnav">
                <button
                  type="button" className="dv3-btn dv3-a-approvebtn" disabled={!readiness.ready || busy !== null}
                  aria-describedby={readiness.ready ? 'dv3-consent' : 'dv3-approve-why dv3-consent'} onClick={() => void run('approve')}
                >
                  {busy === 'approve' ? CARD.approving : CARD.approve} <ArrowLeft size={16} aria-hidden />
                </button>
                <button type="button" className="dv3-btn dv3-btn-ghost" onClick={() => onStep(2)}>{STEPS.back}</button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
