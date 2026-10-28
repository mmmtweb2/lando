import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../lib/api';
import type { LeadFeedItem, LeadsSummary } from '../components/LeadsTable';
import type { OverviewInput } from './journey';

// Everything the v2 overview shows comes from endpoints that already exist and none of them calls
// Google Places, so opening the dashboard costs nothing per visit. Each source fails on its own:
// a failing one only hides its own number instead of breaking the page.

const EMPTY: LeadsSummary = { month_total: 0, month_whatsapp: 0, month_call: 0, month_form: 0, month_email: 0, month_link: 0 };

export interface SeoOverview {
  loading: boolean;
  /** true when the businesses request itself failed (the rest cannot be trusted) */
  failed: boolean;
  input: OverviewInput;
  summary: LeadsSummary;
  items: LeadFeedItem[];
  reload: () => void;
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await authFetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

export function useSeoOverview(): SeoOverview {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Omit<SeoOverview, 'reload'>>({
    loading: true, failed: false, summary: EMPTY, items: [],
    input: { loaded: false, businessName: null, hasBusiness: false, contentCount: 0, monthLeads: 0, subscriptionStatus: null },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [biz, leads, sub] = await Promise.all([
        json<{ businesses?: { id: string; name: string }[] }>('/api/seo/businesses'),
        json<{ items?: LeadFeedItem[]; summary?: LeadsSummary }>('/api/landing/my-leads'),
        json<{ subscription?: { status: 'active' | 'past_due' | 'canceled' } | null }>('/api/seo/subscription'),
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
      const summary = leads?.summary ?? EMPTY;
      setState({
        loading: false,
        failed: biz === null,
        summary,
        items: leads?.items ?? [],
        input: {
          loaded: true,
          businessName: first?.name ?? null,
          hasBusiness: !!first,
          contentCount,
          monthLeads: summary.month_total,
          subscriptionStatus: sub?.subscription?.status ?? null,
        },
      });
    })();
    return () => { cancelled = true; };
  }, [tick]);

  const reload = useCallback(() => { setState((s) => ({ ...s, loading: true })); setTick((t) => t + 1); }, []);
  return { ...state, reload };
}
