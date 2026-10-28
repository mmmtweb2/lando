import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { LeadFeedItem, LeadsSummary } from '../components/LeadsTable';
import type { OverviewInput } from './journey';

// Everything the v2 overview shows comes from endpoints that already exist and none of them calls
// Google Places, so opening the dashboard costs nothing per visit. Each source fails on its own:
// a failing one only hides its own number instead of breaking the page.
//
// Setup ticks (steps done outside Pagey) are saved on the server (migration 032). Until that table
// exists the server answers 503 and the ticks are kept in this browser only; the page says so.

const EMPTY: LeadsSummary = { month_total: 0, month_whatsapp: 0, month_call: 0, month_form: 0, month_email: 0, month_link: 0 };
const LS_PREFIX = 'pagey_setup_ticks:';

export interface SeoOverview {
  loading: boolean;
  /** true when the businesses request itself failed (the rest cannot be trusted) */
  failed: boolean;
  input: OverviewInput;
  summary: LeadsSummary;
  items: LeadFeedItem[];
  /** false = ticks live only in this browser (server table missing) */
  ticksOnServer: boolean;
  setTick: (key: string, done: boolean) => Promise<void>;
  reload: () => void;
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await authFetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

function readLocal(email: string): string[] {
  try { const v = JSON.parse(window.localStorage.getItem(LS_PREFIX + email) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
function writeLocal(email: string, ticks: string[]) {
  try { window.localStorage.setItem(LS_PREFIX + email, JSON.stringify(ticks)); } catch { /* not remembered */ }
}

export function useSeoOverview(): SeoOverview {
  const { user } = useAuth();
  const email = user?.email ?? 'anonymous';
  const [tick, setTick] = useState(0);
  const onServer = useRef(true);
  const [state, setState] = useState<Omit<SeoOverview, 'reload' | 'setTick'>>({
    loading: true, failed: false, summary: EMPTY, items: [], ticksOnServer: true,
    input: { loaded: false, businessName: null, hasBusiness: false, contentCount: 0, monthLeads: 0, subscriptionStatus: null, ticks: [] },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [biz, leads, sub, setup] = await Promise.all([
        json<{ businesses?: { id: string; name: string }[] }>('/api/seo/businesses'),
        json<{ items?: LeadFeedItem[]; summary?: LeadsSummary }>('/api/landing/my-leads'),
        json<{ subscription?: { status: 'active' | 'past_due' | 'canceled' } | null }>('/api/seo/subscription'),
        authFetch('/api/seo/setup').then(async (r) => ({ status: r.status, body: r.ok ? ((await r.json()) as { steps?: string[] }) : null })).catch(() => ({ status: 0, body: null })),
      ]);
      const first = biz?.businesses?.[0] ?? null;
      let contentCount = 0;
      if (first) {
        const [plan, pages] = await Promise.all([
          json<{ kits?: unknown[] }>(`/api/seo/businesses/${encodeURIComponent(first.id)}/plan`),
          json<{ pages?: unknown[] }>(`/api/seo/businesses/${encodeURIComponent(first.id)}/child-pages`),
        ]);
        contentCount = (plan?.kits?.length ?? 0) + (pages?.pages?.length ?? 0);
      }
      if (cancelled) return;
      const server = setup.body !== null;
      onServer.current = server;
      const ticks = server ? (setup.body!.steps ?? []) : readLocal(email);
      const summary = leads?.summary ?? EMPTY;
      setState({
        loading: false,
        failed: biz === null,
        summary,
        items: leads?.items ?? [],
        ticksOnServer: server,
        input: {
          loaded: true,
          businessName: first?.name ?? null,
          hasBusiness: !!first,
          contentCount,
          monthLeads: summary.month_total,
          subscriptionStatus: sub?.subscription?.status ?? null,
          ticks,
        },
      });
    })();
    return () => { cancelled = true; };
  }, [tick, email]);

  const reload = useCallback(() => { setState((s) => ({ ...s, loading: true })); setTick((t) => t + 1); }, []);

  /** Optimistic: the box changes at once; if the server refuses, it goes back. */
  const setTickValue = useCallback(async (key: string, done: boolean) => {
    const apply = (on: boolean) => setState((s) => {
      const has = s.input.ticks.includes(key);
      const ticks = on ? (has ? s.input.ticks : [...s.input.ticks, key]) : s.input.ticks.filter((k) => k !== key);
      if (!onServer.current) writeLocal(email, ticks);
      return { ...s, input: { ...s.input, ticks } };
    });
    apply(done);
    if (!onServer.current) return;
    try {
      const r = await authFetch(`/api/seo/setup/${encodeURIComponent(key)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }),
      });
      if (r.status === 503) {            // table not created yet: keep it in this browser instead
        onServer.current = false;
        setState((s) => { writeLocal(email, s.input.ticks); return { ...s, ticksOnServer: false }; });
      } else if (!r.ok) { apply(!done); }
    } catch { apply(!done); }
  }, [email]);

  return { ...state, setTick: setTickValue, reload };
}
