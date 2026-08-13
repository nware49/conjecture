/**
 * Wire shapes.
 *
 * The client never derives a claim's state. It is computed once, here, from the
 * same domain function the rest of the system uses, and sent down ready to
 * draw. One place decides what is proved.
 */

import {
  CLAIM_STATE_LABEL,
  METHOD_LABEL,
  RUNG_DESCRIPTION,
  RUNG_LABEL,
  SYNC_MESSAGE,
  deriveClaimView,
  syncState,
  type Claim,
  type ClaimView,
  type Pin,
  type Project,
  type Workspace,
  libraryCounts,
  pinCaveat,
  pinLabel,
  verificationBlockedReason,
  canVerify,
} from '@conjecture/core';

export interface ClaimDto {
  id: string;
  title: string;
  declaration: string;
  statement: {
    prose: string;
    lean: string;
    assumptions: readonly string[];
    sync: ReturnType<typeof syncState>;
    syncMessage: string;
  };
  steps: {
    id: string;
    text: string;
    status: string;
    citations: readonly { name: string; origin: string }[];
    elapsedMs: number | null;
  }[];
  gaps: {
    id: string;
    label: string;
    line: number;
    column: number;
    goal: string | null;
    stepId: string | null;
  }[];
  view: {
    state: ClaimView['state'];
    stateLabel: string;
    mark: ClaimView['mark'];
    fill: number;
    summary: string;
    rung: number;
    rungLabel: string;
    rungDescription: string;
    method: string | null;
    methodLabel: string | null;
    scope: string | null;
    sorryCount: number;
    gapCount: number;
    percent: number;
    verifiedSteps: number;
    totalSteps: number;
    staleness: readonly { field: string; name: string; was: string; now: string }[];
    trustsCompiler: boolean;
    customAxioms: readonly string[];
  };
  receipt: Claim['receipt'];
  refutation: Claim['refutation'];
  dependsOn: readonly string[];
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toClaimDto(claim: Claim, pin: Pin | null): ClaimDto {
  const view = deriveClaimView(claim, pin);
  const sync = syncState(claim.statement);

  return {
    id: claim.id,
    title: claim.title,
    declaration: claim.declaration,
    statement: {
      prose: claim.statement.prose,
      lean: claim.statement.lean,
      assumptions: claim.statement.assumptions,
      sync,
      syncMessage: SYNC_MESSAGE[sync],
    },
    steps: claim.steps.map((step) => ({
      id: step.id,
      text: step.text,
      status: view.stepStatus.get(step.id) ?? 'pending',
      citations: step.citations,
      elapsedMs: step.elapsedMs,
    })),
    gaps: claim.gaps.map((gap) => ({
      id: gap.id,
      label: gap.label,
      line: gap.position.line,
      column: gap.position.column,
      goal: gap.goal,
      stepId: gap.stepId,
    })),
    view: {
      state: view.state,
      stateLabel: CLAIM_STATE_LABEL[view.state],
      mark: view.mark,
      fill: view.fill,
      summary: view.summary,
      rung: view.rung,
      rungLabel: RUNG_LABEL[view.rung],
      rungDescription: RUNG_DESCRIPTION[view.rung],
      method: view.method,
      methodLabel: view.method ? METHOD_LABEL[view.method] : null,
      scope: view.scope,
      sorryCount: view.sorryCount,
      gapCount: view.gapCount,
      percent: view.progress.percent,
      verifiedSteps: view.progress.verified,
      totalSteps: view.progress.total,
      staleness: view.staleness,
      trustsCompiler: view.trustsCompiler,
      customAxioms: view.customAxioms,
    },
    receipt: claim.receipt,
    refutation: claim.refutation,
    dependsOn: claim.dependsOn,
    supersededBy: claim.supersededBy,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  };
}

export interface WorkspaceDto {
  project: (Project & { pinLabel: string }) | null;
  engine: Workspace['engine'];
  claims: ClaimDto[];
  counts: ReturnType<typeof libraryCounts>;
  canVerify: boolean;
  blockedReason: string | null;
  /** What this pin cannot see. Non-null for a remote endpoint. */
  pinCaveat: string | null;
}

export function toWorkspaceDto(workspace: Workspace): WorkspaceDto {
  const pin = workspace.project?.pin ?? null;
  return {
    pinCaveat: pinCaveat(workspace.project),
    project: workspace.project
      ? { ...workspace.project, pinLabel: pinLabel(pin) }
      : null,
    engine: workspace.engine,
    claims: workspace.claims.map((claim) => toClaimDto(claim, pin)),
    counts: libraryCounts(workspace.claims, pin),
    canVerify: canVerify(workspace),
    blockedReason: verificationBlockedReason(workspace),
  };
}
