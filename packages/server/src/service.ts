/**
 * The application service.
 *
 * All state changes go through here, and every one of them ends by re-deriving
 * the claim's view from evidence. Nothing in this file sets a claim's state
 * directly, because nothing is allowed to.
 */

import { randomUUID } from 'node:crypto';
import {
  asClaimId,
  asGapId,
  asProjectId,
  asStepId,
  confirmSync,
  deriveClaimView,
  editLean,
  editProse,
  emptyStatement,
  leanDeclName,
  makeClaim,
  makeStep,
  reportAxioms,
  setAssumptions,
  uniqueSlug,
  type Claim,
  type ClaimId,
  type EngineHealth,
  type Gap,
  type Pin,
  type Project,
  type ProofStep,
  type Receipt,
  type Refutation,
  type Workspace,
} from '@conjecture/core';
import {
  connectProject,
  findSorries,
  isEngineError,
  UnavailableLeanEngine,
  type LeanEngine,
} from '@conjecture/lean';
import type { SearchOutcome, SearchRequest } from '@conjecture/refute';
import { notFound, badRequest } from './http.js';
import type { PersistedState, Repository } from './store.js';
import { STATE_VERSION } from './store.js';

/** The pin an exhaustion result is recorded against: this engine, not Lean. */
export const REFUTE_PIN: Pin = {
  toolchain: 'conjecture/refute:1.0.0',
  mathlibRev: null,
  dependencies: {},
  capturedAt: new Date(0).toISOString(),
};

export const NO_ENGINE_REASON =
  'No Lean toolchain on PATH. Claims can be stated and searched for counterexamples; nothing can be kernel-checked until a Lean project is connected.';

export interface CreateClaimInput {
  readonly title: string;
  readonly prose?: string;
  readonly lean?: string;
  readonly assumptions?: readonly string[];
  readonly dependsOn?: readonly string[];
}

export interface UpdateClaimInput {
  readonly title?: string;
  readonly prose?: string;
  readonly lean?: string;
  readonly assumptions?: readonly string[];
  readonly confirmSync?: boolean;
}

export interface ServiceOptions {
  readonly repository: Repository;
  /** Injected so tests can drive a fake toolchain. */
  readonly connect?: typeof connectProject;
  readonly now?: () => Date;
}

export class ConjectureService {
  private state: PersistedState;
  private engine: LeanEngine = new UnavailableLeanEngine(NO_ENGINE_REASON);
  private readonly now: () => Date;
  private readonly connectImpl: typeof connectProject;

  private constructor(
    private readonly repository: Repository,
    state: PersistedState,
    options: ServiceOptions,
  ) {
    this.state = state;
    this.now = options.now ?? (() => new Date());
    this.connectImpl = options.connect ?? connectProject;
  }

  static async open(options: ServiceOptions): Promise<ConjectureService> {
    const state = await options.repository.load();
    const service = new ConjectureService(options.repository, state, options);
    if (state.project) await service.reconnect(state.project.root);
    return service;
  }

  // ── reads ──────────────────────────────────────────────────────────────

  async workspace(): Promise<Workspace> {
    return {
      project: this.state.project,
      claims: this.state.claims,
      engine: await this.engine.health(),
    };
  }

  get pin(): Pin | null {
    return this.state.project?.pin ?? null;
  }

  get claims(): readonly Claim[] {
    return this.state.claims;
  }

  claim(id: string): Claim {
    const found = this.state.claims.find((c) => c.id === id);
    if (!found) throw notFound(`No claim with id ${id}.`);
    return found;
  }

  async engineHealth(): Promise<EngineHealth> {
    return await this.engine.health();
  }

  // ── project ────────────────────────────────────────────────────────────

  async connect(root: string): Promise<{ project: Project | null; steps: unknown; health: EngineHealth }> {
    const result = await this.connectImpl({ root });
    this.engine = result.engine;

    const project: Project | null =
      result.pin === null
        ? null
        : {
            id: asProjectId(randomUUID()),
            name: root.split('/').filter(Boolean).at(-1) ?? root,
            root,
            source: { kind: 'local', path: root },
            pin: result.pin,
            inheritedSorries: result.inheritedSorries,
            limits: { maxHeartbeats: 200_000, elaborationTimeoutMs: 60_000 },
          };

    await this.mutate((state) => ({ ...state, project }));
    return { project, steps: result.steps, health: result.health };
  }

  /** Re-attach an engine to a project already recorded in the workspace. */
  private async reconnect(root: string): Promise<void> {
    try {
      const result = await this.connectImpl({ root });
      this.engine = result.engine;
      if (result.pin && this.state.project) {
        // The environment may have moved while we were away. Record the new
        // pin, which is what turns existing receipts stale.
        const project = { ...this.state.project, pin: result.pin };
        await this.mutate((state) => ({ ...state, project }));
      }
    } catch {
      this.engine = new UnavailableLeanEngine(NO_ENGINE_REASON);
    }
  }

  async disconnect(): Promise<void> {
    await this.engine.dispose();
    this.engine = new UnavailableLeanEngine(NO_ENGINE_REASON);
    await this.mutate((state) => ({ ...state, project: null }));
  }

  // ── claims ─────────────────────────────────────────────────────────────

  async createClaim(input: CreateClaimInput): Promise<Claim> {
    const title = input.title.trim();
    if (title.length === 0) throw badRequest('A claim needs a title.');

    const declaration = uniqueSlug(
      leanDeclName(title),
      this.state.claims.map((c) => c.declaration),
    );

    let statement = emptyStatement();
    if (input.prose) statement = editProse(statement, input.prose);
    if (input.lean) statement = editLean(statement, input.lean);
    if (input.assumptions) statement = setAssumptions(statement, input.assumptions);
    // Both views authored together are in agreement by construction.
    if (input.prose && input.lean) statement = confirmSync(statement);

    const timestamp = this.now().toISOString();
    const claim = makeClaim(asClaimId(randomUUID()), title, declaration, {
      statement,
      dependsOn: (input.dependsOn ?? []).map(asClaimId),
      gaps: gapsFromSource(statement.lean),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await this.mutate((state) => ({ ...state, claims: [...state.claims, claim] }));
    return claim;
  }

  async updateClaim(id: string, input: UpdateClaimInput): Promise<Claim> {
    const existing = this.claim(id);
    let statement = existing.statement;

    if (input.prose !== undefined) statement = editProse(statement, input.prose);
    if (input.lean !== undefined) statement = editLean(statement, input.lean);
    if (input.assumptions !== undefined) statement = setAssumptions(statement, input.assumptions);
    if (input.confirmSync) statement = confirmSync(statement);

    const leanChanged = statement.lean !== existing.statement.lean;

    const updated: Claim = {
      ...existing,
      title: input.title?.trim() || existing.title,
      statement,
      // Editing the Lean invalidates every receipt taken against the old text.
      // Keeping one would be the single most dangerous bug this product could
      // have, so the rule is unconditional.
      receipt: leanChanged ? null : existing.receipt,
      elaborates: leanChanged ? false : existing.elaborates,
      gaps: leanChanged ? gapsFromSource(statement.lean) : existing.gaps,
      steps: leanChanged ? existing.steps.map((s) => ({ ...s, kernelOk: false })) : existing.steps,
      updatedAt: this.now().toISOString(),
    };

    await this.replaceClaim(updated);
    return updated;
  }

  async deleteClaim(id: string): Promise<void> {
    const claim = this.claim(id);
    await this.mutate((state) => ({
      ...state,
      claims: state.claims
        .filter((c) => c.id !== claim.id)
        // Nothing may be left citing a claim that no longer exists.
        .map((c) => ({ ...c, dependsOn: c.dependsOn.filter((d) => d !== claim.id) })),
    }));
  }

  async setSteps(id: string, steps: readonly { text: string; dependsOn?: number[] }[]): Promise<Claim> {
    const claim = this.claim(id);
    const built: ProofStep[] = steps.map((step, index) =>
      makeStep(asStepId(`${claim.id}-s${index}`), step.text, {
        dependsOn: (step.dependsOn ?? []).map((i) => asStepId(`${claim.id}-s${i}`)),
      }),
    );
    const updated = { ...claim, steps: built, updatedAt: this.now().toISOString() };
    await this.replaceClaim(updated);
    return updated;
  }

  // ── verification ───────────────────────────────────────────────────────

  /**
   * Hand the claim to Lean and record what came back.
   *
   * Note what this does *not* do: it never decides the claim is proved. It
   * records evidence — elaboration success, hole count, axiom report — and the
   * domain draws the conclusion.
   */
  async verify(id: string): Promise<{ claim: Claim; diagnostics: unknown; error: string | null }> {
    const claim = this.claim(id);
    const project = this.state.project;

    if (claim.statement.lean.trim().length === 0) {
      throw badRequest('This claim has no Lean to elaborate. State it in Lean first.');
    }

    const result = await this.engine.elaborate({
      relativePath: `${claim.declaration}.lean`,
      source: claim.statement.lean,
      declaration: claim.declaration,
      maxHeartbeats: project?.limits.maxHeartbeats ?? 200_000,
      timeoutMs: project?.limits.elaborationTimeoutMs ?? 60_000,
    });

    if (isEngineError(result)) {
      return { claim, diagnostics: [], error: result.message };
    }

    const pin = project?.pin ?? null;
    const receipt: Receipt | null =
      pin === null
        ? null
        : {
            engine: 'lean-process',
            method: 'lean-kernel',
            scope: null,
            declaration: claim.declaration,
            pin,
            axioms: result.axioms ?? reportAxioms([]),
            sorryCount: result.sorries.length,
            accepted: result.kernelAccepted,
            elapsedMs: result.elapsedMs,
            heartbeats: null,
            verifiedAt: this.now().toISOString(),
          };

    const gaps: Gap[] = result.sorries.map((hole, index) => ({
      id: asGapId(`${claim.id}-g${index}`),
      label: `gap ${index + 1}`,
      position: hole.position,
      goal: result.goals[index]?.raw ?? null,
      stepId: claim.steps[index]?.id ?? null,
    }));

    const updated: Claim = {
      ...claim,
      elaborates: result.diagnostics.every((d) => d.severity !== 'error') || result.sorries.length > 0,
      gaps,
      receipt,
      updatedAt: this.now().toISOString(),
    };

    await this.replaceClaim(updated);
    return { claim: updated, diagnostics: result.diagnostics, error: null };
  }

  /**
   * Fold a finished search into the claim.
   *
   * Three outcomes, three different consequences, and the one that changes
   * nothing has to be as visible as the ones that do.
   */
  async applySearchOutcome(
    id: string,
    outcome: SearchOutcome,
    request: SearchRequest,
    searchId: string | null,
  ): Promise<Claim> {
    const claim = this.claim(id);
    const timestamp = this.now().toISOString();

    if (outcome.kind === 'witness') {
      const refutation: Refutation = {
        witness: outcome.witness,
        // Nothing here reached a kernel. Say so, in the record, permanently.
        authority: 'computed',
        confirmationTerm: null,
        searchId: searchId === null ? null : (searchId as Refutation['searchId']),
        candidatesChecked: outcome.candidatesChecked,
        elapsedMs: outcome.elapsedMs,
        foundAt: timestamp,
      };
      const updated = { ...claim, refutation, updatedAt: timestamp };
      await this.replaceClaim(updated);
      return updated;
    }

    if (outcome.kind === 'exhausted') {
      const scope = describeScope(request, outcome.candidatesChecked);
      const receipt: Receipt = {
        engine: 'exhaustive-search',
        method: 'exhaustion',
        scope,
        declaration: claim.declaration,
        pin: { ...REFUTE_PIN, capturedAt: timestamp },
        axioms: reportAxioms([]),
        sorryCount: 0,
        accepted: true,
        elapsedMs: outcome.elapsedMs,
        heartbeats: null,
        verifiedAt: timestamp,
      };
      const updated: Claim = {
        ...claim,
        receipt,
        // One synthetic step, so progress reads 100% rather than 0% of nothing.
        steps:
          claim.steps.length > 0
            ? claim.steps.map((s) => ({ ...s, kernelOk: true }))
            : [makeStep(asStepId(`${claim.id}-exhaustion`), `Every point of ${scope} checked.`, { kernelOk: true })],
        gaps: [],
        updatedAt: timestamp,
      };
      await this.replaceClaim(updated);
      return updated;
    }

    // budget or error: the claim is untouched. Not refuted, and certainly not
    // proved — the search simply stopped, and the record of that lives on the
    // search, not on the claim.
    return claim;
  }

  /**
   * Turn a counterexample into the next claim: the same statement, bounded
   * below the witness. The most common next move, made one call.
   */
  async weaken(id: string): Promise<Claim> {
    const claim = this.claim(id);
    if (claim.refutation === null) {
      throw badRequest('Nothing to weaken: this claim has no counterexample.');
    }

    const [name, value] = Object.entries(claim.refutation.witness.assignment)[0] ?? ['n', '0'];
    const bound = BigInt(value) - 1n;

    const weakened = await this.createClaim({
      title: `${claim.title} (${name} ≤ ${bound})`,
      prose: claim.statement.prose
        ? `${claim.statement.prose.replace(/\.$/, '')}, for ${name} at most ${bound}.`
        : `${claim.title}, for ${name} at most ${bound}.`,
      lean: claim.statement.lean,
      assumptions: [...claim.statement.assumptions, `${name} ≤ ${bound}`],
    });

    // The refuted claim is preserved and marked superseded, never deleted.
    await this.replaceClaim({ ...claim, supersededBy: weakened.id, updatedAt: this.now().toISOString() });
    return weakened;
  }

  // ── plumbing ───────────────────────────────────────────────────────────

  private async replaceClaim(claim: Claim): Promise<void> {
    await this.mutate((state) => ({
      ...state,
      claims: state.claims.map((c) => (c.id === claim.id ? claim : c)),
    }));
  }

  private async mutate(f: (state: PersistedState) => PersistedState): Promise<void> {
    const next = { ...f(this.state), version: STATE_VERSION, updatedAt: this.now().toISOString() };
    this.state = next;
    await this.repository.save(next);
  }

  /** Replace the whole library. Used by seeding. */
  async replaceAll(claims: readonly Claim[], project: Project | null = null): Promise<void> {
    await this.mutate((state) => ({ ...state, claims: [...claims], project: project ?? state.project }));
  }

  viewOf(claim: Claim): ReturnType<typeof deriveClaimView> {
    return deriveClaimView(claim, this.pin);
  }

  claimIdsFrom(ids: readonly string[]): ClaimId[] {
    return ids.map(asClaimId);
  }
}

/** Gaps read straight out of the source text, before Lean has ever seen it. */
function gapsFromSource(lean: string): Gap[] {
  return findSorries(lean, []).map((hole, index) => ({
    id: asGapId(`src-g${index}-${hole.position.line}-${hole.position.column}`),
    label: `gap ${index + 1}`,
    position: hole.position,
    goal: null,
    stepId: null,
  }));
}

function describeScope(request: SearchRequest, candidates: number): string {
  const ranges = request.variables
    .map((v) => `${v.name} ∈ [${v.from}, ${v.to}]`)
    .join(', ');
  return `${ranges} · ${candidates.toLocaleString('en-US')} candidates`;
}
