/**
 * Receipts and pins.
 *
 * A proof is only valid relative to a toolchain and a library revision, so a
 * verification result is stored together with the exact environment that
 * produced it. Changing either marks every affected result stale; nothing is
 * silently dropped and no cached green tick is trusted.
 */

import type { AxiomReport } from './trust.js';

/** The exact environment proofs in a workspace are recorded against. */
export interface Pin {
  /** Contents of `lean-toolchain`, e.g. "leanprover/lean4:v4.9.0". */
  readonly toolchain: string;
  /** Resolved Mathlib revision from `lake-manifest.json`, when present. */
  readonly mathlibRev: string | null;
  /** Other resolved dependencies, name → revision. */
  readonly dependencies: Readonly<Record<string, string>>;
  readonly capturedAt: string;
}

export function pinsEqual(a: Pin | null, b: Pin | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.toolchain !== b.toolchain) return false;
  if (a.mathlibRev !== b.mathlibRev) return false;
  const aKeys = Object.keys(a.dependencies).sort();
  const bKeys = Object.keys(b.dependencies).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k, i) => bKeys[i] === k && a.dependencies[k] === b.dependencies[k]);
}

/** A short human label for a pin, for the chrome bar. */
export function pinLabel(pin: Pin | null): string {
  if (pin === null) return 'no project pinned';
  const lean = pin.toolchain.replace(/^leanprover\/lean4:/, 'lean ');
  return pin.mathlibRev ? `${lean} · Mathlib @ ${pin.mathlibRev.slice(0, 7)}` : lean;
}

/**
 * How a result was decided.
 *
 * Two authorities can fill a square, and they are never conflated. The Lean
 * kernel type-checks a term and settles the claim as stated. Exhaustion decides
 * a *bounded* claim by evaluating every point of a finite declared space in
 * exact integer arithmetic — a real proof of the bounded statement, and no
 * evidence at all about anything outside the bound. The interface always names
 * which one it was, and exhaustion always carries its scope.
 */
export type VerificationMethod = 'lean-kernel' | 'exhaustion';

export const METHOD_LABEL: Readonly<Record<VerificationMethod, string>> = {
  'lean-kernel': 'kernel-checked',
  exhaustion: 'decided by exhaustion',
};

/**
 * What the deciding authority gave us, recorded. A proof without its receipt is
 * treated as unverified — that rule is enforced in {@link isProvedWithReceipt}.
 */
export interface Receipt {
  readonly engine: 'lean-process' | 'lean-lsp' | 'exhaustive-search';
  readonly method: VerificationMethod;
  /**
   * For exhaustion, exactly what was covered, e.g. "n ∈ [1, 100000] · 100,000
   * candidates". Null for a kernel check, whose scope is the statement itself.
   */
  readonly scope: string | null;
  readonly declaration: string;
  readonly pin: Pin;
  readonly axioms: AxiomReport;
  readonly sorryCount: number;
  /** The deciding authority accepted it: the kernel, or a completed exhaustion. */
  readonly accepted: boolean;
  readonly elapsedMs: number;
  /** Lean's `maxHeartbeats` budget and how much of it the elaboration used. */
  readonly heartbeats: { readonly used: number; readonly budget: number } | null;
  readonly verifiedAt: string;
}

export function isProvedWithReceipt(receipt: Receipt | null | undefined): receipt is Receipt {
  if (!receipt) return false;
  return receipt.accepted && receipt.sorryCount === 0 && !receipt.axioms.dependsOnSorry;
}

/**
 * Is this receipt still good under the workspace's current pin? A stale receipt
 * is drawn as a distinct state — recognisably the same object, visibly not
 * current — rather than being deleted or quietly shown as proved.
 */
export function isReceiptCurrent(receipt: Receipt | null | undefined, pin: Pin | null): boolean {
  if (!receipt) return false;
  // An exhaustion result is arithmetic over a finite space. It does not rest on
  // Mathlib or on a toolchain, so a library bump cannot make it stale — and
  // pretending otherwise would train people to ignore the stale marker.
  if (receipt.method === 'exhaustion') return true;
  if (pin === null) return false;
  return pinsEqual(receipt.pin, pin);
}

export interface StalenessReason {
  readonly field: 'toolchain' | 'mathlib' | 'dependency';
  readonly name: string;
  readonly was: string;
  readonly now: string;
}

/** Exactly what changed under a proof, so the interface can say it out loud. */
export function stalenessReasons(receipt: Receipt, pin: Pin): readonly StalenessReason[] {
  const reasons: StalenessReason[] = [];
  if (receipt.pin.toolchain !== pin.toolchain) {
    reasons.push({
      field: 'toolchain',
      name: 'lean-toolchain',
      was: receipt.pin.toolchain,
      now: pin.toolchain,
    });
  }
  if (receipt.pin.mathlibRev !== pin.mathlibRev) {
    reasons.push({
      field: 'mathlib',
      name: 'Mathlib',
      was: receipt.pin.mathlibRev ?? 'absent',
      now: pin.mathlibRev ?? 'absent',
    });
  }
  const names = new Set([
    ...Object.keys(receipt.pin.dependencies),
    ...Object.keys(pin.dependencies),
  ]);
  for (const name of [...names].sort()) {
    if (name === 'mathlib') continue;
    const was = receipt.pin.dependencies[name] ?? 'absent';
    const now = pin.dependencies[name] ?? 'absent';
    if (was !== now) reasons.push({ field: 'dependency', name, was, now });
  }
  return reasons;
}
