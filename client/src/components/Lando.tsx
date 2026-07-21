// Lando — the brand mascot. Used as the logo (LandoMark) and as a contextual
// companion (LandoBot) that reacts to what's happening: loading, error, success,
// asking a question, requesting info. Palette matches the system tokens.

export type LandoMood =
  | 'default'
  | 'question'
  | 'error'
  | 'request'
  | 'loading'
  | 'success';

const C = {
  navy: '#0E2148',
  screen: '#132A54',
  blue: '#2E63F6',
  shell: '#E9EEFB',
  glow: '#6FE7FF',
  warn: '#FF7A6B',
  ok: '#5AE6A8',
};

interface LandoBotProps {
  mood?: LandoMood;
  size?: number;
  className?: string;
}

export function LandoBot({ mood = 'default', size = 160, className = '' }: LandoBotProps) {
  const chest = mood === 'error' ? C.warn : mood === 'success' ? C.ok : C.glow;
  return (
    <svg
      key={mood}
      viewBox="0 0 140 150"
      width={size}
      height={(size * 150) / 140}
      className={`${mood === 'error' ? 'lando-shake' : ''} ${className}`.trim()}
      style={{ overflow: 'visible', display: 'block' }}
      role="img"
      aria-label="Pagey"
    >
      <path d="M54 112 L44 128 M35 128 H53" stroke={C.navy} strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M86 112 L96 128 M87 128 H105" stroke={C.navy} strokeWidth="5" strokeLinecap="round" fill="none" />

      {mood === 'request' ? (
        <>
          <rect x="32" y="90" width="10" height="20" rx="5" fill={C.blue} />
          <path d="M94 96 Q114 96 120 86" stroke={C.blue} strokeWidth="9" strokeLinecap="round" fill="none" />
          <circle cx="122" cy="82" r="7" fill={C.blue} />
          <g className="lando-float">
            <rect x="113" y="50" width="18" height="22" rx="3" fill={C.shell} stroke={C.navy} strokeWidth="2.5" />
            <path d="M118 57 h8 M118 62 h8 M118 67 h5" stroke={C.navy} strokeWidth="2" strokeLinecap="round" />
          </g>
        </>
      ) : (
        <>
          <rect x="32" y="90" width="10" height="20" rx="5" fill={C.blue} />
          <rect x="98" y="90" width="10" height="20" rx="5" fill={C.blue} />
        </>
      )}

      <rect x="46" y="86" width="48" height="30" rx="12" fill={C.blue} />
      <circle cx="70" cy="101" r="5" fill={chest} className="lando-pulse" />

      {mood === 'error' ? (
        <>
          <path d="M70 28 Q70 16 60 14" stroke={C.navy} strokeWidth="4" strokeLinecap="round" fill="none" />
          <circle cx="57" cy="14" r="4.5" fill={C.warn} />
        </>
      ) : (
        <g transform={mood === 'question' ? 'rotate(16 70 28)' : undefined}>
          <line x1="70" y1="28" x2="70" y2="12" stroke={C.navy} strokeWidth="4" strokeLinecap="round" />
          {mood === 'success' ? (
            <path d="M70 3 L72.5 8.5 L78 11 L72.5 13.5 L70 19 L67.5 13.5 L62 11 L67.5 8.5 Z" fill={C.ok} />
          ) : (
            <circle cx="70" cy="9" r="4.5" fill={C.glow} className="lando-pulse" />
          )}
        </g>
      )}

      <rect x="24" y="44" width="8" height="18" rx="4" fill={C.blue} />
      <rect x="108" y="44" width="8" height="18" rx="4" fill={C.blue} />
      <rect x="32" y="26" width="76" height="56" rx="18" fill={C.shell} stroke={C.navy} strokeWidth="3" />
      <rect x="42" y="36" width="56" height="36" rx="10" fill={C.screen} />

      {mood === 'default' && (
        <>
          <circle cx="57" cy="51" r="5.5" fill={C.glow} />
          <circle cx="83" cy="51" r="5.5" fill={C.glow} />
          <path d="M61 61 Q70 67 79 61" stroke={C.glow} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      )}
      {mood === 'question' && (
        <>
          <circle cx="57" cy="51" r="6.5" fill={C.glow} />
          <path d="M77 51 h12" stroke={C.glow} strokeWidth="4" strokeLinecap="round" />
          <circle cx="70" cy="63" r="3.5" stroke={C.glow} strokeWidth="3" fill="none" />
          <text x="112" y="30" fontSize="30" fontWeight="800" fill={C.blue} className="lando-bob">?</text>
        </>
      )}
      {mood === 'error' && (
        <>
          <path d="M50 47 L64 53" stroke={C.glow} strokeWidth="4" strokeLinecap="round" />
          <path d="M90 47 L76 53" stroke={C.glow} strokeWidth="4" strokeLinecap="round" />
          <path d="M61 66 Q70 59 79 66" stroke={C.glow} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      )}
      {mood === 'request' && (
        <>
          <circle cx="57" cy="51" r="5.5" fill={C.glow} />
          <circle cx="83" cy="51" r="5.5" fill={C.glow} />
          <path d="M62 62 Q70 66 78 62" stroke={C.glow} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      )}
      {mood === 'loading' && (
        <>
          <circle cx="56" cy="54" r="4.5" fill={C.glow} className="lando-blink" style={{ animationDelay: '0s' }} />
          <circle cx="70" cy="54" r="4.5" fill={C.glow} className="lando-blink" style={{ animationDelay: '.2s' }} />
          <circle cx="84" cy="54" r="4.5" fill={C.glow} className="lando-blink" style={{ animationDelay: '.4s' }} />
        </>
      )}
      {mood === 'success' && (
        <>
          <path d="M50 53 Q57 45 64 53" stroke={C.glow} strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M76 53 Q83 45 90 53" stroke={C.glow} strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M58 60 Q70 71 82 60" stroke={C.glow} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

interface LandoMarkProps {
  size?: number;
  className?: string;
}

// Head-only variant — logo mark / favicon.
export function LandoMark({ size = 48, className = '' }: LandoMarkProps) {
  return (
    <svg viewBox="24 0 92 86" width={size} height={size} className={className} style={{ display: 'block' }} role="img" aria-label="Pagey">
      <line x1="70" y1="28" x2="70" y2="12" stroke={C.navy} strokeWidth="5" strokeLinecap="round" />
      <circle cx="70" cy="9" r="5" fill={C.glow} />
      <rect x="24" y="44" width="8" height="18" rx="4" fill={C.blue} />
      <rect x="108" y="44" width="8" height="18" rx="4" fill={C.blue} />
      <rect x="32" y="26" width="76" height="56" rx="18" fill={C.shell} stroke={C.navy} strokeWidth="3" />
      <rect x="42" y="36" width="56" height="36" rx="10" fill={C.screen} />
      <circle cx="57" cy="51" r="6" fill={C.glow} />
      <circle cx="83" cy="51" r="6" fill={C.glow} />
      <path d="M61 61 Q70 67 79 61" stroke={C.glow} strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  );
}
