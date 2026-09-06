import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { authFetch } from '../lib/api';

interface WalletBadgeProps {
  email: string | null | undefined;
  refreshKey?: number;
  className?: string;
  onLoad?: (credits: number) => void;
}

export default function WalletBadge({ email, refreshKey = 0, className = '', onLoad }: WalletBadgeProps) {
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (!email) return;
    authFetch('/api/users/credits')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { credits?: number } | null) => {
        if (data == null) return; // not logged in / no access → hide badge
        const c = data.credits ?? 0;
        setCredits(c);
        onLoad?.(c);
      })
      .catch(() => { /* keep badge hidden on error */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, refreshKey]);

  if (credits === null) return null;

  const low = credits <= 2;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium select-none cursor-default ${
        low
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-slate-200 bg-white text-slate-900'
      } ${className}`}
      title={`${credits} קרדיטים זמינים`}
    >
      <Coins size={13} className={low ? 'text-amber-500' : 'text-slate-400'} />
      <span className="font-semibold tabular-nums">{credits}</span>
      <span className="opacity-60">קרדיטים</span>
    </span>
  );
}
