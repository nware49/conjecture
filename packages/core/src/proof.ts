/**
 * Proof steps and gaps.
 *
 * Every step carries its own glyph and its own receipt. A step that is argued
 * but unchecked looks different from one the kernel accepted — that distinction
 * is the entire product, so it lives in the type system rather than in a class
 * name somewhere in the view layer.
 */

import type { GapId, StepId } from './ids.js';

export interface SourcePos {
  /** 1-based, as Lean reports it. */
  readonly line: number;
  /** 0-based column, as Lean reports it. */
  readonly column: number;
}

export interface SourceRange {
  readonly start: SourcePos;
  readonly end: SourcePos;
}

export function formatPos(pos: SourcePos): string {
  return `${pos.line}:${pos.column}`;
}

/** A named hole. One `sorry` in the file, one row in the gap list. */
export interface Gap {
  readonly id: GapId;
  readonly label: string;
  readonly position: SourcePos;
  /** The goal state Lean reported at the hole, verbatim. Never paraphrased. */
  readonly goal: string | null;
  /** Which step, if any, this hole belongs to. */
  readonly stepId: StepId | null;
}

export interface Citation {
  /** Fully qualified declaration name, e.g. `Nat.le_induction`. */
  readonly name: string;
  /** Where it came from. `workspace` means another claim in this library. */
  readonly origin: 'mathlib' | 'workspace' | 'project' | 'core';
}

export type StepStatus =
  /** The kernel accepted this step's contribution. */
  | 'verified'
  /** Argued in prose, not formalised. There is a `sorry` under it. */
  | 'gap'
  /** Fine in itself, but downstream of a gap, so it proves nothing yet. */
  | 'blocked'
  /** Written down, not yet run. */
  | 'pending';

export interface ProofStep {
  readonly id: StepId;
  readonly text: string;
  readonly citations: readonly Citation[];
  /** Set once the kernel has accepted the elaborated step. */
  readonly kernelOk: boolean;
  /** Elapsed elaboration time for this step, in ms, when measured. */
  readonly elapsedMs: number | null;
  /** Steps that must land before this one means anything. */
  readonly dependsOn: readonly StepId[];
}

export function makeStep(id: StepId, text: string, partial: Partial<ProofStep> = {}): ProofStep {
  return {
    id,
    text,
    citations: partial.citations ?? [],
    kernelOk: partial.kernelOk ?? false,
    elapsedMs: partial.elapsedMs ?? null,
    dependsOn: partial.dependsOn ?? [],
  };
}

/**
 * Derive each step's status from evidence.
 *
 * A step is `gap` when a hole sits in it, `blocked` when anything it depends on
 * is not verified, `verified` only when the kernel said so. Blocking is
 * transitive: a step three levels above a hole is still not proved, and the
 * interface has no business implying otherwise.
 */
export function deriveStepStatuses(
  steps: readonly ProofStep[],
  gaps: readonly Gap[],
): ReadonlyMap<StepId, StepStatus> {
  const gapSteps = new Set(gaps.map((g) => g.stepId).filter((id): id is StepId => id !== null));
  const byId = new Map(steps.map((s) => [s.id, s]));
  const status = new Map<StepId, StepStatus>();

  const resolve = (id: StepId, seen: ReadonlySet<StepId>): StepStatus => {
    const cached = status.get(id);
    if (cached) return cached;
    const step = byId.get(id);
    if (!step) return 'pending';
    // A dependency cycle is a malformed proof, not a crash. Report it as
    // blocked and let the graph view show the loop.
    if (seen.has(id)) return 'blocked';

    let result: StepStatus;
    if (gapSteps.has(id)) {
      result = 'gap';
    } else {
      const nextSeen = new Set(seen).add(id);
      const blocked = step.dependsOn.some((dep) => resolve(dep, nextSeen) !== 'verified');
      result = blocked ? 'blocked' : step.kernelOk ? 'verified' : 'pending';
    }
    status.set(id, result);
    return result;
  };

  for (const step of steps) resolve(step.id, new Set());
  return status;
}

export interface ProofProgress {
  readonly total: number;
  readonly verified: number;
  /** Verified steps as a fraction in [0, 1]. */
  readonly fraction: number;
  /**
   * The fraction snapped to eighths. The mark fills in eight discrete steps and
   * never as a smooth gradient — a proof is discrete, so the glyph is too.
   */
  readonly octile: number;
  /** Percent, floored. Never rounded up: 99.6% verified is not proved. */
  readonly percent: number;
}

export function proofProgress(statuses: ReadonlyMap<StepId, StepStatus>): ProofProgress {
  const total = statuses.size;
  let verified = 0;
  for (const s of statuses.values()) if (s === 'verified') verified += 1;
  const fraction = total === 0 ? 0 : verified / total;
  return {
    total,
    verified,
    fraction,
    octile: Math.round(fraction * 8) / 8,
    percent: Math.floor(fraction * 100),
  };
}
