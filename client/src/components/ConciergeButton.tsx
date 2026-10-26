import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { getPublicConfig } from '../lib/publicConfig';
import { trackEvent } from '../lib/track';

// "I have no time to set this up, connect me on WhatsApp." The number comes from the server
// (CONCIERGE_WHATSAPP); without it the button is not rendered at all.

export default function ConciergeButton({
  location, businessName, score,
}: { location: 'audit' | 'embed'; businessName?: string; score?: number }) {
  const [number, setNumber] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getPublicConfig().then(c => { if (alive) setNumber(c?.concierge ?? null); });
    return () => { alive = false; };
  }, []);
  if (!number) return null;

  const parts = ['היי, אין לי זמן להגדיר לבד ואשמח שתעזרו לי בקידום העסק בגוגל.'];
  if (businessName) parts.push(`העסק: ${businessName}.`);
  if (typeof score === 'number') parts.push(`הציון שקיבלתי: ${score} מתוך 100.`);
  const href = `https://wa.me/${number}?text=${encodeURIComponent(parts.join(' '))}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => trackEvent('Concierge_Clicked', { location })}
      className="inline-flex items-center gap-2 self-start rounded-lg border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
    >
      <MessageCircle size={16} /> אין לי זמן להגדיר, תחברו אותי בוואטסאפ
    </a>
  );
}
