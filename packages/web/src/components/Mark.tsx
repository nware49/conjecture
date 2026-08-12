/**
 * The mark: a turnstile driving into a tombstone. `⊢ ∎`.
 *
 * The square's fill *is* the product's status field, so the logo, the sidebar
 * row, the favicon and the share card are the same object at different sizes.
 * There is exactly one component, and it takes a state — nothing anywhere else
 * is allowed to draw a filled square.
 */

import type { CSSProperties } from 'react';

export type MarkState = 'open' | 'partial' | 'proved' | 'refuted' | 'stale';

export interface MarkProps {
  state: MarkState;
  /** Fill fraction for the partial state, snapped to eighths by the domain. */
  fill?: number;
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Below 24px the aperture closes up, so small sizes get a thinner stroke and a
 * correspondingly wider opening. Same object, still legible at 12px in a
 * sidebar row.
 */
function geometry(size: number): { weight: number; apertureTop: number; apertureHeight: number; apertureX: number } {
  const weight = size < 24 ? 5 : 6;
  return {
    weight,
    // The square is stroked on its centre line, so the opening is 22 - weight.
    apertureX: 31 + weight / 2,
    apertureTop: 21 + weight / 2,
    apertureHeight: 22 - weight,
  };
}

export function Mark({ state, fill = 0, size = 16, title, className, style }: MarkProps): JSX.Element {
  const refuted = state === 'refuted';
  const stale = state === 'stale';
  const { weight, apertureX, apertureTop, apertureHeight } = geometry(size);

  const fraction = state === 'proved' || stale ? 1 : state === 'partial' ? fill : 0;
  // Eight discrete steps, never a smooth gradient. A proof is discrete; the
  // mark should be too.
  const height = (Math.round(fraction * 8) / 8) * apertureHeight;

  const stroke = refuted ? 'var(--refuted)' : 'currentColor';

  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        flex: 'none',
        lineHeight: 0,
        // Staleness is the same object, visibly not current.
        opacity: stale ? 0.45 : 1,
        ...style,
      }}
    >
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role={title ? 'img' : 'presentation'}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <g stroke={stroke} strokeWidth={weight} strokeLinecap="square" fill="none">
          <path d="M11 12V52" />
          <path d="M11 32H31" />
        </g>
        {height > 0 && (
          <rect
            x={apertureX}
            y={apertureTop + apertureHeight - height}
            width={22 - weight}
            height={height}
            fill="var(--proved)"
          />
        )}
        <rect
          x={31}
          y={21}
          width={22}
          height={22}
          fill="none"
          stroke={stroke}
          strokeWidth={weight}
          strokeDasharray={stale ? '5 3' : undefined}
        />
        {refuted && <path d="M31 43L53 21" stroke="var(--refuted)" strokeWidth={weight} strokeLinecap="square" />}
      </svg>
    </span>
  );
}

/**
 * The wordmark, set like a journal attribution: the head in bold roman, the
 * byline in serif italic beside it, never competing.
 */
export function Wordmark({
  size = 15,
  attribution = true,
}: {
  size?: number;
  attribution?: boolean;
}): JSX.Element {
  return (
    <span style={{ letterSpacing: '-0.015em', lineHeight: 1, fontSize: size }}>
      <b style={{ fontWeight: 700 }}>Conjecture</b>
      {attribution && (
        <>
          {' '}
          <i
            style={{
              fontFamily: 'var(--serif)',
              fontStyle: 'italic',
              fontWeight: 400,
              fontSize: '0.78em',
              color: 'var(--slate)',
            }}
          >
            for Claude
          </i>
        </>
      )}
    </span>
  );
}
