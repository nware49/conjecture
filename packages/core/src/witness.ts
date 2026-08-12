/**
 * Counterexamples.
 *
 * A refutation is a result, not an error. It gets the same treatment as a
 * proof, including its own receipt, and it records honestly how much authority
 * stands behind it: exact arithmetic from the search engine is strong evidence,
 * and it is still not the Lean kernel saying so.
 */

import type { SearchId } from './ids.js';

export interface Witness {
  /** Variable name → exact decimal value. Strings, because these are BigInts. */
  readonly assignment: Readonly<Record<string, string>>;
  /** The failing evaluation written out, e.g. "40^2 + 40 + 41 = 1681 = 41 * 41". */
  readonly evaluation: string;
}

export type RefutationAuthority =
  /**
   * Found and independently re-evaluated by the search engine in exact
   * integer arithmetic. Reproducible, and not a kernel check.
   */
  | 'computed'
  /** Lean accepted a term for the negation. This is the real thing. */
  | 'kernel-confirmed';

export const REFUTATION_AUTHORITY_NOTE: Readonly<Record<RefutationAuthority, string>> = {
  computed: 'Found by exact search. Not yet confirmed by Lean.',
  'kernel-confirmed': 'Search found it; Lean confirmed it.',
};

export interface Refutation {
  readonly witness: Witness;
  readonly authority: RefutationAuthority;
  /** The Lean term that confirmed it, when there is one. */
  readonly confirmationTerm: string | null;
  readonly searchId: SearchId | null;
  readonly candidatesChecked: number;
  readonly elapsedMs: number;
  readonly foundAt: string;
}

export function refutationSummary(r: Refutation): string {
  const vars = Object.entries(r.witness.assignment)
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ');
  return vars.length > 0 ? vars : 'witness found';
}
