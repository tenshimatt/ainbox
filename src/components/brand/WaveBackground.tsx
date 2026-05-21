/**
 * Animated royal-blue background — drifting blurred blobs.
 * CSS-only animation (see globals.css). Respects prefers-reduced-motion.
 *
 * Variants:
 *  - "top":    blobs anchored top-right + mid-left (hero)
 *  - "bottom": blobs anchored bottom-centre (footer)
 */
type Props = { variant?: 'top' | 'bottom'; className?: string };

export function WaveBackground({ variant = 'top', className = '' }: Props) {
  const isTop = variant === 'top';
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`}
    >
      {/* Base wash */}
      <div
        className="absolute inset-0"
        style={{
          background: isTop
            ? 'radial-gradient(120% 80% at 85% 10%, #B7C8F7 0%, #D7E0FB 30%, #EAF0FD 55%, #FFFFFF 85%)'
            : 'radial-gradient(120% 90% at 50% 110%, #6486EA 0%, #8EA7F1 20%, #B7C8F7 40%, #FFFFFF 80%)',
        }}
      />

      {/* Vivid royal-blue blob (primary) */}
      <div
        className="blob blob-a"
        style={{
          top:    isTop ? '-20%' : 'auto',
          bottom: isTop ? 'auto' : '-20%',
          right:  isTop ? '-15%' : 'auto',
          left:   isTop ? 'auto' : '50%',
          marginLeft: isTop ? 0 : '-35%',
          width:  '70%',
          height: '70%',
          background:
            'conic-gradient(from 200deg at 50% 50%, #2347E5 0deg, #4169E1 50deg, #6486EA 110deg, #B7C8F7 170deg, transparent 230deg)',
          opacity: 0.95,
        }}
      />

      {/* Secondary deep-blue blob */}
      <div
        className="blob blob-b"
        style={{
          top:    isTop ? '5%'   : 'auto',
          bottom: isTop ? 'auto' : '5%',
          left:   '-15%',
          width:  '55%',
          height: '55%',
          background:
            'radial-gradient(closest-side, #2347E5 0%, #4169E1 30%, #8EA7F1 60%, transparent 80%)',
          opacity: 0.8,
        }}
      />

      {/* Tertiary cyan/lavender highlight */}
      <div
        className="blob blob-c"
        style={{
          top:    isTop ? '25%'  : 'auto',
          bottom: isTop ? 'auto' : '25%',
          right:  '15%',
          width:  '40%',
          height: '40%',
          background:
            'radial-gradient(closest-side, #6486EA 0%, #B7C8F7 50%, transparent 80%)',
          opacity: 0.7,
        }}
      />
    </div>
  );
}
