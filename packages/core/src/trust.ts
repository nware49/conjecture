/**
 * The trust ladder.
 *
 * This is the load-bearing idea in the product. Six rungs, and the interface
 * must never let one be mistaken for the one above it. Everything upstream of
 * the Lean kernel is a suggestion — including everything the model says — so
 * the ladder is computed from evidence, never asserted.
 */

/** Axioms every ordinary Mathlib development already depends on. */
export const STANDARD_AXIOMS = ['propext', 'Classical.choice', 'Quot.sound'] as const;

/**
 * Axioms that mean the Lean *compiler* is now part of the trusted base,
 * introduced by `native_decide`. Still a proof; a bigger thing to trust.
 */
export const COMPILER_TRUST_AXIOMS = ['Lean.ofReduceBool', 'Lean.trustCompiler'] as const;

/**
 * The axiom `sorry` elaborates to. Its presence in `#print axioms` output means
 * the declaration is not proved at all, whatever else the build said.
 */
export const SORRY_AXIOM = 'sorryAx';

export type AxiomKind = 'standard' | 'compiler-trust' | 'sorry' | 'custom';

export interface ClassifiedAxiom {
  readonly name: string;
  readonly kind: AxiomKind;
}

export function classifyAxiom(name: string): AxiomKind {
  if (name === SORRY_AXIOM) return 'sorry';
  if ((STANDARD_AXIOMS as readonly string[]).includes(name)) return 'standard';
  if ((COMPILER_TRUST_AXIOMS as readonly string[]).includes(name)) return 'compiler-trust';
  return 'custom';
}

export interface AxiomReport {
  /** Every axiom the declaration transitively depends on, as Lean reported it. */
  readonly axioms: readonly ClassifiedAxiom[];
  /** True when the axiom set is exactly (a subset of) the standard three. */
  readonly standardOnly: boolean;
  /** True when `native_decide` pulled the compiler into the trusted base. */
  readonly trustsCompiler: boolean;
  /** True when `sorryAx` appears — the declaration leans on an unfilled hole. */
  readonly dependsOnSorry: boolean;
  /** Axioms outside the standard set and outside the known compiler-trust set. */
  readonly custom: readonly string[];
}

export function reportAxioms(names: readonly string[]): AxiomReport {
  const axioms = names.map((name) => ({ name, kind: classifyAxiom(name) }));
  const custom = axioms.filter((a) => a.kind === 'custom').map((a) => a.name);
  return {
    axioms,
    standardOnly: axioms.every((a) => a.kind === 'standard'),
    trustsCompiler: axioms.some((a) => a.kind === 'compiler-trust'),
    dependsOnSorry: axioms.some((a) => a.kind === 'sorry'),
    custom,
  };
}

/**
 * Rungs 1–6 exactly as specified in the design document.
 *
 * Note rung 6 is not "more trusted" than rung 5 — it is rung 4 or 5 carrying a
 * caveat. Use {@link isProvedRung} for truth and {@link RUNG_LABEL} for display;
 * never sort on the rung number itself.
 */
export type TrustRung = 1 | 2 | 3 | 4 | 5 | 6;

export const RUNG_LABEL: Readonly<Record<TrustRung, string>> = {
  1: 'plausible',
  2: 'typed',
  3: 'skeleton',
  4: 'proved',
  5: 'proved · standard axioms',
  6: 'proved · trusts compiler',
};

export const RUNG_DESCRIPTION: Readonly<Record<TrustRung, string>> = {
  1: 'Prose only. Carries no weight.',
  2: 'The statement elaborates. A well-formed proposition, nothing more.',
  3: 'The skeleton compiles with sorry. The shape is right; the gaps are named.',
  4: 'Zero sorry. The kernel accepted the term.',
  5: 'Axioms confined to propext, Classical.choice, Quot.sound.',
  6: 'Proved, but native_decide put the Lean compiler in the trusted base.',
};

export function isProvedRung(rung: TrustRung): boolean {
  return rung >= 4;
}

export interface TrustEvidence {
  /** Did the statement itself elaborate as a proposition? */
  readonly elaborates: boolean;
  /** Number of `sorry` holes remaining in the proof. */
  readonly sorryCount: number;
  /** Did the kernel accept a term for this declaration? */
  readonly kernelAccepted: boolean;
  /** Result of `#print axioms`, when it has been run. */
  readonly axioms?: AxiomReport | undefined;
}

/**
 * Classify evidence onto the ladder.
 *
 * The order of the checks is the whole point: nothing reaches rung 4 without
 * `kernelAccepted`, and an axiom report mentioning `sorryAx` demotes a claim
 * no matter what the build output said.
 */
export function classifyTrust(evidence: TrustEvidence): TrustRung {
  const { elaborates, sorryCount, kernelAccepted, axioms } = evidence;

  if (!elaborates) return 1;

  // `#print axioms` is the last word. A declaration that reaches sorryAx is a
  // skeleton wearing a proof's clothes, and it never climbs past rung 3.
  if (axioms?.dependsOnSorry) return 3;

  if (!kernelAccepted || sorryCount > 0) {
    return sorryCount > 0 ? 3 : 2;
  }

  if (axioms === undefined) return 4;
  if (axioms.trustsCompiler) return 6;
  if (axioms.standardOnly) return 5;

  // Custom axioms: proved, but against foundations we have not vouched for.
  // Deliberately not rung 5 — the interface has to say something extra here.
  return 4;
}

/**
 * The one-line summary shown beside the glyph. Terse and exact, in the house
 * voice: say what happened, count nothing generously.
 */
export function trustSummary(rung: TrustRung, evidence: TrustEvidence): string {
  switch (rung) {
    case 1:
      return 'open';
    case 2:
      return 'open · typed';
    case 3:
      return `${evidence.sorryCount} sorry`;
    case 4:
      return evidence.axioms && evidence.axioms.custom.length > 0
        ? `proved · ${evidence.axioms.custom.length} custom ${
            evidence.axioms.custom.length === 1 ? 'axiom' : 'axioms'
          }`
        : 'proved';
    case 5:
      return `${evidence.axioms?.axioms.length ?? 3} axioms`;
    case 6:
      return 'trusts compiler';
  }
}
