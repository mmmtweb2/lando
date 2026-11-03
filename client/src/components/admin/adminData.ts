// Shared pieces of the admin tabs: a GET hook, formatters and Hebrew labels (no components, see adminUi.tsx).
import { useCallback, useEffect, useState } from 'react';

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** GET one admin endpoint. `error` is a short Hebrew message, never a raw server string. */
export function useAdminData<T>(adminFetch: Fetcher, path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchOnce = useCallback(() => {
    adminFetch(path)
      .then(async (r) => {
        const b = await r.json().catch(() => ({})) as { error?: string; code?: string };
        if (!r.ok) throw new Error(b.code === 'not_migrated' ? 'חסרה מיגרציה 040 במסד הנתונים.' : 'הטעינה נכשלה.');
        setData(b as T); setError(null);
      })
      .catch((e: Error) => setError(e.message || 'הטעינה נכשלה.'))
      .finally(() => setLoading(false));
  }, [adminFetch, path]);
  useEffect(fetchOnce, [fetchOnce]);
  const reload = useCallback(() => { setLoading(true); fetchOnce(); }, [fetchOnce]);
  return { data, error, loading, reload };
}

export const ils = (n: number) => `₪${Math.round(n).toLocaleString('he-IL')}`;
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('he-IL') : '—');
export const hoursText = (h: number | null) => (h === null ? '—' : h < 48 ? `${h} שעות` : `${Math.round(h / 24)} ימים`);
export const pctText = (n: number | null) => (n === null ? '—' : `${n}%`);

export const STATE_LABEL: Record<string, string> = {
  registered: 'נרשם', setup: 'בהקמה', ready_to_activate: 'מוכן להפעלה', active_beta: 'פעיל (בטא)', active: 'משלם',
};
export const PREMIUM_LABEL: Record<string, string> = { active: 'פעיל', paused: 'מושהה', ended: 'הסתיים' };
export const REC_LABEL: Record<string, string> = {
  reviews: 'מעט ביקורות', rating: 'דירוג נמוך', photos: 'מעט תמונות', website: 'אין אתר', phone: 'אין טלפון', hours: 'שעות פעילות', category: 'קטגוריה', status: 'סטטוס העסק',
};
