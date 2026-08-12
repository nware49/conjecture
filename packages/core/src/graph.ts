/**
 * The dependency graph — what actually holds up the roof.
 *
 * Edges are citations read out of elaborated proof terms, not from anybody's
 * account of the proof. Layout is bottom-up: assumptions at the floor, the goal
 * at the ceiling, so reading up the page is reading the proof.
 */

import type { Claim, ClaimState } from './claim.js';
import { deriveClaimView } from './claim.js';
import type { ClaimId } from './ids.js';
import type { Pin } from './receipt.js';

export interface GraphNode {
  readonly id: ClaimId;
  readonly title: string;
  readonly declaration: string;
  readonly state: ClaimState;
  readonly fill: number;
  /** 0 at the floor. Longest-path layering, so an edge always goes up. */
  readonly layer: number;
  /** True when this node lies on a path from a leaf to the goal. */
  readonly onCriticalPath: boolean;
  /**
   * True when a refuted claim below has invalidated this one. The proof may
   * still be intact; what it rests on is not.
   */
  readonly invalidated: boolean;
}

export interface GraphEdge {
  /** The cited claim — lower in the picture. */
  readonly from: ClaimId;
  /** The claim doing the citing — higher in the picture. */
  readonly to: ClaimId;
  readonly onCriticalPath: boolean;
  /** The edge runs out of, or through, something a counterexample killed. */
  readonly dead: boolean;
}

export interface DependencyGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** The claim the picture is about, if one was named. */
  readonly goal: ClaimId | null;
  /** Unproved claims the goal transitively rests on. */
  readonly blockers: readonly ClaimId[];
  /** Cycles found while layering. A cycle is a malformed proof, not a crash. */
  readonly cycles: readonly (readonly ClaimId[])[];
  readonly layerCount: number;
}

/** Claims that transitively cite `id`, nearest first. */
export function downstreamOf(claims: readonly Claim[], id: ClaimId): readonly ClaimId[] {
  const citedBy = new Map<ClaimId, ClaimId[]>();
  for (const claim of claims) {
    for (const dep of claim.dependsOn) {
      const list = citedBy.get(dep) ?? [];
      list.push(claim.id);
      citedBy.set(dep, list);
    }
  }
  const out: ClaimId[] = [];
  const seen = new Set<ClaimId>([id]);
  let frontier = citedBy.get(id) ?? [];
  while (frontier.length > 0) {
    const next: ClaimId[] = [];
    for (const cur of frontier) {
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      next.push(...(citedBy.get(cur) ?? []));
    }
    frontier = next;
  }
  return out;
}

/** Claims `id` transitively rests on. */
export function upstreamOf(claims: readonly Claim[], id: ClaimId): readonly ClaimId[] {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const out: ClaimId[] = [];
  const seen = new Set<ClaimId>([id]);
  let frontier = [...(byId.get(id)?.dependsOn ?? [])];
  while (frontier.length > 0) {
    const next: ClaimId[] = [];
    for (const cur of frontier) {
      if (seen.has(cur)) continue;
      seen.add(cur);
      out.push(cur);
      next.push(...(byId.get(cur)?.dependsOn ?? []));
    }
    frontier = next;
  }
  return out;
}

/**
 * Longest-path layering with cycle tolerance.
 *
 * Depth-first with an explicit stack so a pathological graph cannot blow the
 * call stack, and so cycles are reported rather than hung on.
 */
function layerNodes(
  ids: readonly ClaimId[],
  depsOf: (id: ClaimId) => readonly ClaimId[],
): { layers: Map<ClaimId, number>; cycles: ClaimId[][] } {
  const layers = new Map<ClaimId, number>();
  const cycles: ClaimId[][] = [];
  const state = new Map<ClaimId, 'visiting' | 'done'>();

  const visit = (start: ClaimId): void => {
    const path: ClaimId[] = [];
    const stack: { id: ClaimId; expanded: boolean }[] = [{ id: start, expanded: false }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (!frame.expanded) {
        const seen = state.get(frame.id);
        if (seen === 'done') {
          stack.pop();
          continue;
        }
        if (seen === 'visiting') {
          const at = path.indexOf(frame.id);
          cycles.push(at >= 0 ? path.slice(at) : [frame.id]);
          stack.pop();
          continue;
        }
        state.set(frame.id, 'visiting');
        path.push(frame.id);
        frame.expanded = true;
        for (const dep of depsOf(frame.id)) stack.push({ id: dep, expanded: false });
        continue;
      }

      // All dependencies resolved: this node sits one layer above the tallest.
      let layer = 0;
      for (const dep of depsOf(frame.id)) {
        const depLayer = layers.get(dep);
        if (depLayer !== undefined) layer = Math.max(layer, depLayer + 1);
      }
      layers.set(frame.id, layer);
      state.set(frame.id, 'done');
      path.pop();
      stack.pop();
    }
  };

  for (const id of ids) if (!state.has(id)) visit(id);
  return { layers, cycles };
}

export interface BuildGraphOptions {
  readonly goal?: ClaimId | null;
  readonly pin: Pin | null;
}

export function buildGraph(claims: readonly Claim[], options: BuildGraphOptions): DependencyGraph {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const ids = claims.map((c) => c.id);
  const depsOf = (id: ClaimId): readonly ClaimId[] =>
    (byId.get(id)?.dependsOn ?? []).filter((d) => byId.has(d));

  const { layers, cycles } = layerNodes(ids, depsOf);
  const views = new Map(claims.map((c) => [c.id, deriveClaimView(c, options.pin)]));

  const goal = options.goal ?? null;
  const critical = new Set<ClaimId>();
  if (goal !== null && byId.has(goal)) {
    critical.add(goal);
    for (const up of upstreamOf(claims, goal)) critical.add(up);
  }

  // A counterexample poisons everything above it. The proof of a downstream
  // claim may be perfectly good; what it rests on is gone.
  const invalidated = new Set<ClaimId>();
  for (const claim of claims) {
    if (views.get(claim.id)?.state === 'refuted') {
      for (const down of downstreamOf(claims, claim.id)) invalidated.add(down);
    }
  }

  const nodes: GraphNode[] = claims.map((claim) => {
    const view = views.get(claim.id)!;
    return {
      id: claim.id,
      title: claim.title,
      declaration: claim.declaration,
      state: view.state,
      fill: view.fill,
      layer: layers.get(claim.id) ?? 0,
      onCriticalPath: critical.has(claim.id),
      invalidated: invalidated.has(claim.id),
    };
  });

  const edges: GraphEdge[] = [];
  for (const claim of claims) {
    for (const dep of claim.dependsOn) {
      if (!byId.has(dep)) continue;
      const depRefuted = views.get(dep)?.state === 'refuted';
      edges.push({
        from: dep,
        to: claim.id,
        onCriticalPath: critical.has(dep) && critical.has(claim.id),
        dead: depRefuted || invalidated.has(dep),
      });
    }
  }

  // One hollow node on the critical path means the whole result is hollow,
  // no matter how much yellow surrounds it.
  const blockers =
    goal === null
      ? []
      : [goal, ...upstreamOf(claims, goal)].filter((id) => {
          const state = views.get(id)?.state;
          return state !== undefined && state !== 'proved';
        });

  return {
    nodes,
    edges,
    goal,
    blockers,
    cycles,
    layerCount: nodes.reduce((max, n) => Math.max(max, n.layer + 1), 0),
  };
}
