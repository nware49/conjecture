/**
 * The claim aggregate and — the important part — the single function that
 * decides what a claim's state actually is.
 *
 * Nothing else in the system is allowed to set a claim's state directly. It is
 * always derived from evidence: receipts, holes, witnesses and the current pin.
 * That is what makes "the square only fills when the kernel accepts a term"
 * a property of the program rather than a promise in a document.
 */

import type { ClaimId, GapId, StepId } from './ids.js';
import type { Gap, ProofStep, StepStatus } from './proof.js';
import { deriveStepStatuses, proofProgress, type ProofProgress } from './proof.js';
import type { Pin, Receipt, StalenessReason } from './receipt.js';
import { isProvedWithReceipt, isReceiptCurrent, stalenessReasons } from './receipt.js';
import type { Statement } from './statement.js';
import { emptyStatement } from './statement.js';
import { classifyTrust, trustSummary, type TrustEvidence, type TrustRung } from './trust.js';
import type { Refutation } from './witness.js';

/** The five states the mark can be in. */
export type ClaimState = 'open' | 'in_progress' | 'proved' | 'refuted' | 'stale';

/** Which glyph to draw. Kept separate from state so the view stays dumb. */
export type MarkState = 'open' | 'partial' | 'proved' | 'refuted' | 'stale';

export interface Claim {
  readonly id: ClaimId;
  readonly title: string;
  /** The Lean declaration this claim compiles to. */
  readonly declaration: string;
  readonly statement: Statement;
  readonly steps: readonly ProofStep[];
  readonly gaps: readonly Gap[];
  /** Did the statement itself elaborate as a proposition? Rung 2. */
  readonly elaborates: boolean;
  readonly receipt: Receipt | null;
  readonly refutation: Refutation | null;
  /** Claims this one cites, by id. Read out of elaborated terms, not prose. */
  readonly dependsOn: readonly ClaimId[];
  /** Set when a counterexample forced this claim to be replaced by a weaker one. */
  readonly supersededBy: ClaimId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function makeClaim(
  id: ClaimId,
  title: string,
  declaration: string,
  partial: Partial<Claim> = {},
): Claim {
  const now = partial.createdAt ?? new Date(0).toISOString();
  return {
    id,
    title,
    declaration,
    statement: partial.statement ?? emptyStatement(),
    steps: partial.steps ?? [],
    gaps: partial.gaps ?? [],
    elaborates: partial.elaborates ?? false,
    receipt: partial.receipt ?? null,
    refutation: partial.refutation ?? null,
    dependsOn: partial.dependsOn ?? [],
    supersededBy: partial.supersededBy ?? null,
    createdAt: now,
    updatedAt: partial.updatedAt ?? now,
  };
}

/** Everything the interface needs to render a claim, derived in one place. */
export interface ClaimView {
  readonly state: ClaimState;
  readonly mark: MarkState;
  readonly rung: TrustRung;
  readonly progress: ProofProgress;
  readonly stepStatus: ReadonlyMap<StepId, StepStatus>;
  readonly sorryCount: number;
  readonly gapCount: number;
  /** Fill height for the mark, snapped to eighths. */
  readonly fill: number;
  /** The terse status line, e.g. "62% verified · 1 sorry · 1 gap". */
  readonly summary: string;
  /** Non-empty exactly when the claim is stale. */
  readonly staleness: readonly StalenessReason[];
  /** True when the result stands but the trusted base is larger than standard. */
  readonly trustsCompiler: boolean;
  readonly customAxioms: readonly string[];
}

/**
 * Derive a claim's state from evidence and the workspace pin.
 *
 * Order matters and is deliberate:
 *   1. A confirmed counterexample ends the argument.
 *   2. A proof only counts with a receipt that matches the current pin.
 *   3. A receipt that no longer matches the pin is stale, not proved.
 *   4. Everything else is open or in progress, by hole count.
 */
export function deriveClaimView(claim: Claim, pin: Pin | null): ClaimView {
  const stepStatus = deriveStepStatuses(claim.steps, claim.gaps);
  const progress = proofProgress(stepStatus);
  const gapCount = claim.gaps.length;
  const sorryCount = claim.receipt?.sorryCount ?? gapCount;

  const axioms = claim.receipt?.axioms;
  const evidence: TrustEvidence = {
    elaborates: claim.elaborates,
    sorryCount,
    kernelAccepted: claim.receipt?.kernelAccepted ?? false,
    axioms,
  };
  const rung = classifyTrust(evidence);

  const base = {
    rung,
    progress,
    stepStatus,
    sorryCount,
    gapCount,
    trustsCompiler: axioms?.trustsCompiler ?? false,
    customAxioms: axioms?.custom ?? [],
  };

  if (claim.refutation !== null) {
    return {
      ...base,
      state: 'refuted',
      mark: 'refuted',
      fill: 0,
      summary: refutedSummary(claim.refutation),
      staleness: [],
    };
  }

  const proved = isProvedWithReceipt(claim.receipt);

  if (proved && isReceiptCurrent(claim.receipt, pin)) {
    return {
      ...base,
      state: 'proved',
      mark: 'proved',
      fill: 1,
      summary: provedSummary(claim, rung, evidence),
      staleness: [],
    };
  }

  if (proved && claim.receipt !== null && pin !== null) {
    const reasons = stalenessReasons(claim.receipt, pin);
    return {
      ...base,
      state: 'stale',
      mark: 'stale',
      fill: 1,
      summary: `stale · ${describeStaleness(reasons)}`,
      staleness: reasons,
    };
  }

  if (progress.verified > 0 || gapCount > 0) {
    return {
      ...base,
      state: 'in_progress',
      mark: 'partial',
      fill: progress.octile,
      summary: inProgressSummary(progress, sorryCount, gapCount),
      staleness: [],
    };
  }

  return {
    ...base,
    state: 'open',
    mark: 'open',
    fill: 0,
    summary: trustSummary(rung, evidence),
    staleness: [],
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function provedSummary(claim: Claim, rung: TrustRung, evidence: TrustEvidence): string {
  const parts = ['proved', '0 sorry'];
  if (claim.receipt) {
    parts.push(`kernel-checked in ${(claim.receipt.elapsedMs / 1000).toFixed(1)}s`);
  }
  if (rung === 6) parts.push('trusts compiler');
  else if (evidence.axioms) parts.push(plural(evidence.axioms.axioms.length, 'axiom'));
  return parts.join(' · ');
}

function inProgressSummary(progress: ProofProgress, sorryCount: number, gapCount: number): string {
  const parts = [`${progress.percent}% verified`];
  parts.push(`${sorryCount} sorry`);
  if (gapCount !== sorryCount) parts.push(plural(gapCount, 'gap'));
  return parts.join(' · ');
}

function refutedSummary(refutation: Refutation): string {
  const assignment = Object.entries(refutation.witness.assignment)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  const authority =
    refutation.authority === 'kernel-confirmed' ? 'kernel-confirmed' : 'search only';
  return `refuted · ${assignment} · ${authority}`;
}

function describeStaleness(reasons: readonly StalenessReason[]): string {
  if (reasons.length === 0) return 'environment changed';
  const first = reasons[0]!;
  const rest = reasons.length - 1;
  const head = first.field === 'toolchain' ? 'toolchain changed' : `${first.name} changed`;
  return rest > 0 ? `${head} +${rest} more` : head;
}

/** Convenience for the sidebar: the four groups are the four glyphs. */
export const CLAIM_STATE_ORDER: readonly ClaimState[] = [
  'open',
  'in_progress',
  'proved',
  'stale',
  'refuted',
];

export const CLAIM_STATE_LABEL: Readonly<Record<ClaimState, string>> = {
  open: 'Open',
  in_progress: 'In progress',
  proved: 'Proved',
  stale: 'Stale',
  refuted: 'Refuted',
};

export function groupByState(
  claims: readonly Claim[],
  pin: Pin | null,
): ReadonlyMap<ClaimState, readonly Claim[]> {
  const groups = new Map<ClaimState, Claim[]>();
  for (const state of CLAIM_STATE_ORDER) groups.set(state, []);
  for (const claim of claims) {
    groups.get(deriveClaimView(claim, pin).state)!.push(claim);
  }
  return groups;
}

export function findGap(claim: Claim, gapId: GapId): Gap | undefined {
  return claim.gaps.find((g) => g.id === gapId);
}
