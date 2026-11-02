import { useCallback, useEffect, useState } from 'react';

interface Item { id: string; email: string; kind: 'bug' | 'idea' | 'other'; message: string; page: string | null; seen: boolean; created_at: string }
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const KIND: Record<Item['kind'], string> = { bug: 'משהו לא עובד', idea: 'רעיון', other: 'אחר' };

/** Admin: feedback sent by testers from the dashboard (migration 034). */
export default function FeedbackAdminPanel({ adminFetch }: { adminFetch: Fetcher }) {
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch('/api/admin/feedback')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('טעינת המשוב נכשלה'))))
      .then((b: { items: Item[]; notMigrated?: boolean }) => { setItems(b.items ?? []); setNote(b.notMigrated ? 'הטבלה עדיין לא נוצרה (מיגרציה 034).' : null); })
      .catch((e: Error) => setNote(e.message));
  }, [adminFetch]);
  useEffect(load, [load]);

  async function toggle(it: Item) {
    await adminFetch(`/api/admin/feedback/${it.id}/seen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seen: !it.seen }) });
    load();
  }
  const unseen = items.filter((i) => !i.seen).length;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-700 text-sm">משוב מבודקים</h2>
        <p className="text-xs text-slate-400 mt-0.5">{note ?? `${items.length} הודעות, ${unseen} שלא נקראו.`}</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {items.map((it) => (
          <li key={it.id} className={`px-5 py-3 text-sm ${it.seen ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
              <span><b className="text-slate-700">{KIND[it.kind]}</b> · <span dir="ltr">{it.email}</span>{it.page ? ` · ${it.page}` : ''} · {new Date(it.created_at).toLocaleString('he-IL')}</span>
              <button type="button" onClick={() => toggle(it)} className="text-blue-600 hover:underline">{it.seen ? 'סמן כלא נקרא' : 'נקרא'}</button>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{it.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
