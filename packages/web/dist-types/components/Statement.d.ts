/**
 * The middle column: the claim itself, in both views, and the proof steps.
 *
 * Prose and Lean are two views of one statement. Editing either flags the other
 * as out of date, and the flag is never hidden — silent divergence is how you
 * end up proving the wrong theorem and feeling good about it.
 */
import { type Claim } from '../api.js';
export declare function Statement({ claim }: {
    claim: Claim;
}): JSX.Element;
//# sourceMappingURL=Statement.d.ts.map