/**
 * The workspace aggregate: a connected Lean project, the pin its proofs are
 * recorded against, and the library of claims.
 *
 * The empty-state rule lives here. With no project connected the library still
 * opens — you can state claims, you just cannot prove any, and every square
 * stays hollow.
 */

import type { Claim, ClaimState } from './claim.js';
import { deriveClaimView, CLAIM_STATE_ORDER } from './claim.js';
import type { ProjectId } from './ids.js';
import type { Pin } from './receipt.js';

export type EngineKind = 'lean-process' | 'unavailable';

export type EngineHealth =
  | { readonly status: 'ready'; readonly kind: EngineKind; readonly detail: string }
  | { readonly status: 'building'; readonly kind: EngineKind; readonly detail: string }
  | { readonly status: 'unavailable'; readonly kind: EngineKind; readonly reason: string };

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  /** Absolute path on disk, or a git URL that has been cloned to one. */
  readonly root: string;
  readonly source: { readonly kind: 'git'; readonly url: string; readonly branch: string } | {
    readonly kind: 'local';
    readonly path: string;
  };
  readonly pin: Pin | null;
  /** `sorry`s that were already in the repository when it was connected. */
  readonly inheritedSorries: number;
  readonly limits: {
    readonly maxHeartbeats: number;
    readonly elaborationTimeoutMs: number;
  };
}

export interface Workspace {
  readonly project: Project | null;
  readonly claims: readonly Claim[];
  readonly engine: EngineHealth;
}

export interface LibraryCounts {
  readonly byState: Readonly<Record<ClaimState, number>>;
  readonly total: number;
  readonly totalSorries: number;
  /** Fraction of claims that are proved under the current pin. */
  readonly provedFraction: number;
}

export function libraryCounts(claims: readonly Claim[], pin: Pin | null): LibraryCounts {
  const byState: Record<ClaimState, number> = {
    open: 0,
    in_progress: 0,
    proved: 0,
    refuted: 0,
    stale: 0,
  };
  let totalSorries = 0;
  for (const claim of claims) {
    const view = deriveClaimView(claim, pin);
    byState[view.state] += 1;
    totalSorries += view.sorryCount;
  }
  return {
    byState,
    total: claims.length,
    totalSorries,
    provedFraction: claims.length === 0 ? 0 : byState.proved / claims.length,
  };
}

/**
 * Can anything be proved right now? Used to decide whether the interface offers
 * a kernel check at all, rather than offering one that will always fail.
 */
export function canVerify(workspace: Workspace): boolean {
  return workspace.engine.status === 'ready' && workspace.project?.pin != null;
}

/**
 * Why not, in the house voice: say what happened, propose the next move, and
 * do not apologise.
 */
export function verificationBlockedReason(workspace: Workspace): string | null {
  if (workspace.project === null) {
    return 'No project connected. Claims can be stated; nothing can be checked until a Lean project is attached.';
  }
  if (workspace.engine.status === 'unavailable') {
    return workspace.engine.reason;
  }
  if (workspace.engine.status === 'building') {
    return `Building: ${workspace.engine.detail}`;
  }
  if (workspace.project.pin === null) {
    return 'The project has no readable lean-toolchain, so proofs could not be pinned to an environment.';
  }
  return null;
}

export function orderedStates(): readonly ClaimState[] {
  return CLAIM_STATE_ORDER;
}
