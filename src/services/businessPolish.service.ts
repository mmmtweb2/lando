// "שיפור הניסוח" (README part 144): one strong suggestion for the business description or the list of
// services, from a fast model, checked in code (businessPolish.ts) before the owner ever sees it.
// Nothing is saved here: the owner accepts in the dashboard and the normal save path (PUT /gbp/profile/:field)
// takes it from there. No credits are used and nothing about the business is logged.
import Anthropic from '@anthropic-ai/sdk';
import { para, type TruthCard, emptyCard, MAX_SERVICES } from './businessTruth';
import { readState } from './gbpSync';
import {
  type Issue, type PolishField, type PolishedService, type ServiceValue, type ServicesSuggestion,
  PolishCounter, accountKey, applyServicesAnswer, cardCategory, checkDescription, checkServices, descriptionPrompt, DESC_SHORT,
  fixDescription, hasErrors, normalizeServices, parseModelJson, readServicesAnswer, servicesPrompt,
} from './businessPolish';

export const POLISH_MODEL = 'claude-haiku-4-5';
const POLISH_TIMEOUT_MS = 20_000;

type Client = { messages: { create: (args: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message> } };

export type PolishErrorCode = 'not_found' | 'limit' | 'unavailable' | 'failed' | 'invalid' | 'empty';
export class PolishError extends Error {
  constructor(public readonly code: PolishErrorCode) { super(code); }
}

export interface PolishDeps {
  /** null = no model configured */
  client: Client | null;
  card(email: string): Promise<{ card: TruthCard; googleServices: string[] | null; attributeLabels: string[] } | null>;
  counter: PolishCounter;
  timeoutMs?: number;
}

export interface DescriptionPolish {
  field: 'description';
  before: string;
  /** hints on the owner's own text */
  beforeIssues: Issue[];
  suggestion: string;
  /** warnings left on the suggestion (never errors: those are fixed or the suggestion is not offered) */
  issues: Issue[];
  /** true when the owner's text was already fine and the suggestion is the same */
  unchanged: boolean;
  remaining: number;
}

export interface ServicesPolish {
  field: 'services';
  before: ServiceValue[];
  beforeIssues: Issue[];
  suggestion: PolishedService[];
  forgotten: string[];
  issues: Issue[];
  unchanged: boolean;
  remaining: number;
}

export type PolishResult = DescriptionPolish | ServicesPolish;

export interface PolishInput {
  /** what the owner has in the editor now (unsaved); the saved value when absent */
  draft?: unknown;
  /** earlier suggestions in this dialog, so "ניסוח אחר" is really another one */
  previous?: unknown;
}

// ── the real dependencies ────────────────────────────────────────────────────

const sharedCounter = new PolishCounter();

async function loadCard(email: string): Promise<{ card: TruthCard; googleServices: string[] | null; attributeLabels: string[] } | null> {
  const { realDeps } = await import('./gbpSync.service');   // lazy: keeps this module free of Supabase for the tests
  const row = await realDeps.row(email);
  if (!row) return null;
  const card: TruthCard = { ...emptyCard(), ...(row.card ?? {}) };
  const st = readState(row.google_state);
  const labels = (st.attributeMeta?.items ?? []).filter((i) => card.attributes?.[i.name] === true).map((i) => i.label);
  return { card, googleServices: st.google ? st.google.services.map((s) => s.name) : null, attributeLabels: labels };
}

export function realPolishDeps(): PolishDeps {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return { client: apiKey ? (new Anthropic({ apiKey }) as unknown as Client) : null, card: loadCard, counter: sharedCounter };
}

// ── the model ────────────────────────────────────────────────────────────────

async function ask(client: Client, system: string, user: string, temperature: number, timeoutMs: number): Promise<string> {
  const call = client.messages.create({ model: POLISH_MODEL, max_tokens: 1500, temperature, system, messages: [{ role: 'user', content: user }] });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('polish timeout')), timeoutMs); });
  try {
    const r = await Promise.race([call, timeout]);
    const block = r.content.find((b) => b.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  } finally {
    if (timer) clearTimeout(timer);
    call.catch(() => undefined);   // a late failure after the timeout must not surface as an unhandled rejection
  }
}

const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
const log = (field: PolishField, outcome: string, tries: number, started: number) =>
  console.info(`[POLISH] field=${field} outcome=${outcome} tries=${tries} ms=${Date.now() - started}`);   // nothing about the business

function draftServices(v: unknown, fallback: ServiceValue[]): ServiceValue[] {
  if (!Array.isArray(v)) return fallback.map((s) => ({ name: s.name, description: s.description }));
  return v.slice(0, MAX_SERVICES * 2).flatMap((s) => {
    const o = (s ?? {}) as { name?: unknown; description?: unknown };
    return typeof o.name === 'string' ? [{ name: o.name, description: typeof o.description === 'string' ? o.description : '' }] : [];
  });
}

/**
 * One suggestion for `field`. Throws PolishError: `limit` (3 a day per field used up), `unavailable` (no model),
 * `failed` (no suggestion that passes the checks; the allowance is given back), `empty` (no services to tidy).
 */
export async function polish(email: string, field: PolishField, input: PolishInput, deps: PolishDeps = realPolishDeps(), now = new Date()): Promise<PolishResult> {
  const found = await deps.card(email);
  if (!found) throw new PolishError('not_found');
  if (!deps.client) throw new PolishError('unavailable');
  const { card, attributeLabels } = found;
  const category = cardCategory(card);
  const account = accountKey(email);

  if (field === 'services') {
    const list = normalizeServices(draftServices(input.draft, card.services));
    if (!list.length) throw new PolishError('empty');
    if (!deps.counter.take(account, field, now)) throw new PolishError('limit');
    const started = Date.now();
    // Google never loses items: a name Google already has is kept (renaming would add a second item there).
    const locked = new Set((found.googleServices ?? []).map((n) => n.trim().toLowerCase()));
    const previous: ServicesSuggestion[] = (Array.isArray(input.previous) ? input.previous : []).slice(-2)
      .map((p) => ({ services: draftServices(p, []).slice(0, MAX_SERVICES).map((s, i) => ({ ...s, from: [i], locked: false })), forgotten: [] }));
    let fix: Issue[] | undefined;
    for (let tries = 1; tries <= 2; tries++) {
      let raw = '';
      try {
        const p = servicesPrompt({ card, list, locked, category, attributeLabels, previous, fix });
        raw = await ask(deps.client, p.system, p.user, previous.length ? 0.9 : 0.4, deps.timeoutMs ?? POLISH_TIMEOUT_MS);
      } catch { if (tries === 2) break; continue; }
      const answer = readServicesAnswer(parseModelJson(raw));
      if (!answer) { fix = [{ code: 'empty', level: 'error', text: 'invalid JSON or shape' }]; continue; }
      const s = applyServicesAnswer(list, answer, card, locked, { category, attributeLabels });
      // anything still wrong falls back to the owner's own row
      const issues = checkServices(s.services, card, { category, attributeLabels, draft: list.map((x) => `${x.name} ${x.description}`).join('\n') });
      const bad = new Set(issues.filter((i) => i.level === 'error' && i.index !== undefined).map((i) => i.index as number));
      const services = s.services.flatMap((row, i) => (bad.has(i) ? row.from.map((f) => ({ ...list[f], from: [f], locked: locked.has(list[f].name.trim().toLowerCase()) })) : [row]));
      const after = checkServices(services, card, { category, attributeLabels, draft: list.map((x) => `${x.name} ${x.description}`).join('\n') });
      if (hasErrors(after)) { fix = after.filter((i) => i.level === 'error'); continue; }
      log(field, 'ok', tries, started);
      return {
        field, before: list, beforeIssues: checkServices(list, card, { category, attributeLabels }),
        suggestion: services, forgotten: s.forgotten, issues: after,
        unchanged: services.length === list.length && services.every((r, i) => same(r.name, list[i].name) && same(r.description, list[i].description)) && !s.forgotten.length,
        remaining: deps.counter.remaining(account, field, now),
      };
    }
    deps.counter.refund(account, field, now);
    log(field, 'failed', 2, started);
    throw new PolishError('failed');
  }

  const draft = typeof input.draft === 'string' ? para(input.draft, 1500) : card.description;
  if (!deps.counter.take(account, field, now)) throw new PolishError('limit');
  const started = Date.now();
  const previous = (Array.isArray(input.previous) ? input.previous : []).filter((x): x is string => typeof x === 'string').slice(-2).map((x) => para(x, 800));
  const opts = { category, draft, attributeLabels };
  let fix: Issue[] | undefined;
  let best = '';
  for (let tries = 1; tries <= 2; tries++) {
    let raw = '';
    try {
      const p = descriptionPrompt({ card, draft, category, attributeLabels, previous, fix });
      raw = await ask(deps.client, p.system, p.user, previous.length ? 0.9 : 0.5, deps.timeoutMs ?? POLISH_TIMEOUT_MS);
    } catch { if (tries === 2) break; continue; }
    const o = parseModelJson<{ description?: unknown }>(raw);
    const text = typeof o?.description === 'string' ? o.description : '';
    if (!text.trim()) { fix = [{ code: 'empty', level: 'error', text: 'invalid JSON or empty description' }]; continue; }
    const before = checkDescription(text, card, opts);
    const fixed = fixDescription(text, card, opts);
    const after = checkDescription(fixed, card, opts);
    // A clean answer is offered; one that needed heavy cutting is tried once more with what was wrong.
    const cutHard = fixed.length < Math.min(DESC_SHORT, text.length * 0.7);
    if (!hasErrors(after) && fixed.length >= 80 && (!cutHard || tries === 2)) {
      log(field, 'ok', tries, started);
      return {
        field, before: draft, beforeIssues: draft ? checkDescription(draft, card, opts) : [], suggestion: fixed,
        issues: after, unchanged: same(fixed, draft), remaining: deps.counter.remaining(account, field, now),
      };
    }
    if (!hasErrors(after) && fixed.length >= 80) best = fixed;
    fix = before.filter((i) => i.level === 'error').concat(fixed.length < DESC_SHORT ? [{ code: 'too_short', level: 'error', text: 'too short' }] : []);
  }
  if (best) {
    log(field, 'ok_best', 2, started);
    return { field, before: draft, beforeIssues: draft ? checkDescription(draft, card, opts) : [], suggestion: best, issues: checkDescription(best, card, opts), unchanged: same(best, draft), remaining: deps.counter.remaining(account, field, now) };
  }
  deps.counter.refund(account, field, now);
  log(field, 'failed', 2, started);
  throw new PolishError('failed');
}
