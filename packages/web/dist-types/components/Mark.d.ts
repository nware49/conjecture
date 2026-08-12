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
export declare function Mark({ state, fill, size, title, className, style }: MarkProps): JSX.Element;
/**
 * The wordmark, set like a journal attribution: the head in bold roman, the
 * byline in serif italic beside it, never competing.
 */
export declare function Wordmark({ size, attribution, }: {
    size?: number;
    attribution?: boolean;
}): JSX.Element;
//# sourceMappingURL=Mark.d.ts.map