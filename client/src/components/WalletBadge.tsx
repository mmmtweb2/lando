import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

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
    supabase
      .from('user_profiles')
      .select('credits')
      .eq('email', email)
      .maybeSingle()
      .then(({ data }) => {
        const c = (data as { credits?: number } | null)?.credits ?? 0;
        setCredits(c);
        onLoad?.(c);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, refreshKey]);

  if (credits === null) return null;

  const low = credits <= 2;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold select-none ${className}`}
      title={`${credits} קרדיטים זמינים`}
      style={{
        background: low
          ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
          : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        color: '#fff',
        boxShadow: low
          ? '0 0 10px rgba(239,68,68,0.35)'
          : '0 0 10px rgba(99,102,241,0.4)',
      }}
    >
      <span className="text-amber-300">✦</span>
      {credits}
      <span className="opacity-80 font-medium">קרדיטים</span>
    </span>
  );
}
