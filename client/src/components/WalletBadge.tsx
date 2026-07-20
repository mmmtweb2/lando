import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
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
    <motion.span
      whileHover={{ scale: 1.12, rotate: [0, -5, 5, -3, 0] }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 10 }}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold select-none cursor-default border-2 ${className}`}
      title={`${credits} קרדיטים זמינים`}
      style={{
        background: low
          ? '#FF7A6B'
          : '#2E63F6',
        borderColor: low ? 'rgba(255,122,107,0.45)' : 'rgba(111,231,255,0.7)',
        color: '#fff',
        boxShadow: low
          ? '0 0 16px rgba(255,122,107,0.4), inset 0 1px 0 rgba(255,255,255,0.25)'
          : '0 0 16px rgba(46,99,246,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
      }}
    >
      <span className="text-yellow-300">✦</span>
      {credits}
      <span className="opacity-80 font-medium">קרדיטים</span>
    </motion.span>
  );
}
