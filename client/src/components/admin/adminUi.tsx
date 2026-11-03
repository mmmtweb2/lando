import type { ReactNode } from 'react';
export function Card({ title, sub, children, right }: { title: string; sub?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-700 text-sm">{title}</h2>
          {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-col gap-1">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className={`text-3xl font-bold ${tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-800'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export function State({ loading, error, retry }: { loading: boolean; error: string | null; retry: () => void }) {
  if (loading) return <p className="text-sm text-slate-400" role="status">טוען…</p>;
  if (error) return (
    <p className="text-sm text-red-600" role="alert">
      {error} <button type="button" onClick={retry} className="underline">נסו שוב</button>
    </p>
  );
  return null;
}

