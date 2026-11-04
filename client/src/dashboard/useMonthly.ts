import { useCallback, useEffect, useState } from 'react';
import type { OverviewInput } from './journey';
import { deriveMonthly, markDone, markSkipped, monthKey, observe, parseMonth, type MonthlyId, type MonthlyView, type MonthState } from './monthly';

// Browser-kept state of this month's tasks (see monthly.ts). Reading storage can throw, so every
// access is guarded; without storage the month simply starts clean on each visit.
const KEY = 'pagey_month_tasks:';
function read(email: string, key: string, contentCount: number): MonthState {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(KEY + email); } catch { /* none */ }
  return parseMonth(raw, key, contentCount);
}
function write(email: string, s: MonthState) { try { window.localStorage.setItem(KEY + email, JSON.stringify(s)); } catch { /* not remembered */ } }

export interface Monthly {
  view: MonthlyView;
  done: (id: MonthlyId) => void;
  skip: (id: MonthlyId) => void;
}

export function useMonthly(email: string, input: OverviewInput, requestsSent: number, pendingReplies: number | null): Monthly {
  const [key] = useState(() => monthKey(new Date()));
  const [stored, setStored] = useState<MonthState>(() => read(email, key, input.contentCount));
  const data = { input, requestsSent, pendingReplies };
  const state = observe(stored, data);
  const seen = state.repliesSeen;
  useEffect(() => { if (seen !== stored.repliesSeen) write(email, state); });
  const done = useCallback((id: MonthlyId) => setStored((s) => { const n = markDone(observe(s, { input, requestsSent, pendingReplies }), id); write(email, n); return n; }), [email, input, requestsSent, pendingReplies]);
  const skip = useCallback((id: MonthlyId) => setStored((s) => { const n = markSkipped(observe(s, { input, requestsSent, pendingReplies }), id); write(email, n); return n; }), [email, input, requestsSent, pendingReplies]);
  return { view: deriveMonthly(data, state), done, skip };
}
