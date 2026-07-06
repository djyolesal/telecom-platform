/**
 * Logo « Écrou-signal » E&M OpS : un écrou hexagonal (la maintenance)
 * dont le cœur émet un signal (la connectivité). Palette plateforme.
 */
export function LogoIcon({ size = 32, variant = 'light' }: { size?: number; variant?: 'light' | 'dark' }) {
  const ink = variant === 'dark' ? '#FFFFFF' : '#1B3F6B';
  const sig = variant === 'dark' ? '#3BC9AF' : '#0E7C6B';
  const dot = variant === 'dark' ? '#FFB020' : '#F59E0B';
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <path d="M104 60 L82 98 L38 98 L16 60 L38 22 L82 22 Z" fill="none" stroke={ink} strokeWidth="9" strokeLinejoin="round" />
      <circle cx="60" cy="64" r="7" fill={dot} />
      <path d="M46 52 A18 18 0 0 1 74 52" fill="none" stroke={sig} strokeWidth="6.5" strokeLinecap="round" />
      <path d="M40 45 A25 25 0 0 1 80 45" fill="none" stroke={sig} strokeWidth="6.5" strokeLinecap="round" />
    </svg>
  );
}

/** Nom de l'app avec le « OpS » en teal (E&M marine / blanc selon le fond). */
export function LogoWordmark({ variant = 'light', className = '' }: { variant?: 'light' | 'dark'; className?: string }) {
  const ops = variant === 'dark' ? '#3BC9AF' : '#0E7C6B';
  return (
    <span className={className}>
      E&amp;M <span style={{ color: ops }}>OpS</span>
    </span>
  );
}
