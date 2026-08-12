import { describe, expect, it } from 'vitest';
import { makeClaim, type Claim } from './claim.js';
import { buildGraph, downstreamOf, upstreamOf } from './graph.js';
import { asClaimId, asStepId } from './ids.js';
import { makeStep } from './proof.js';
import type { Pin, Receipt } from './receipt.js';
import { reportAxioms, STANDARD_AXIOMS } from './trust.js';
import type { Refutation } from './witness.js';

const pin: Pin = {
  toolchain: 'leanprover/lean4:v4.9.0',
  mathlibRev: 'a1b2c3d',
  dependencies: { mathlib: 'a1b2c3d' },
  capturedAt: '2026-01-01T00:00:00.000Z',
};

const receipt = (declaration: string): Receipt => ({
  engine: 'lean-process',
  method: 'lean-kernel',
  scope: null,
  declaration,
  pin,
  axioms: reportAxioms([...STANDARD_AXIOMS]),
  sorryCount: 0,
  accepted: true,
  elapsedMs: 400,
  heartbeats: null,
  verifiedAt: '2026-01-01T00:00:00.000Z',
});

const proved = (id: string, title: string, deps: string[] = []): Claim =>
  makeClaim(asClaimId(id), title, id, {
    elaborates: true,
    steps: [makeStep(asStepId(`${id}-s`), 'step', { kernelOk: true })],
    receipt: receipt(id),
    dependsOn: deps.map(asClaimId),
  });

const open = (id: string, title: string, deps: string[] = []): Claim =>
  makeClaim(asClaimId(id), title, id, { elaborates: true, dependsOn: deps.map(asClaimId) });

const refutation: Refutation = {
  witness: { assignment: { n: '93' }, evaluation: 'f(93) = 188 > 186' },
  authority: 'computed',
  confirmationTerm: null,
  searchId: null,
  candidatesChecked: 93,
  elapsedMs: 5,
  foundAt: '2026-01-01T00:00:00.000Z',
};

describe('upstream and downstream', () => {
  const claims = [
    proved('base', 'Base case'),
    proved('parity', 'Parity reduction', ['base']),
    open('tail', 'Tail bound', ['parity']),
    open('goal', 'Goal', ['tail']),
  ];

  it('walks upstream transitively', () => {
    expect(upstreamOf(claims, asClaimId('goal'))).toEqual(
      ['tail', 'parity', 'base'].map(asClaimId),
    );
  });

  it('walks downstream transitively', () => {
    expect(downstreamOf(claims, asClaimId('base'))).toEqual(
      ['parity', 'tail', 'goal'].map(asClaimId),
    );
  });

  it('does not loop forever on a cycle, and does not report the origin as its own dependent', () => {
    const cyclic = [open('a', 'A', ['b']), open('b', 'B', ['a'])];
    expect(downstreamOf(cyclic, asClaimId('a'))).toEqual([asClaimId('b')]);
    expect(upstreamOf(cyclic, asClaimId('a'))).toEqual([asClaimId('b')]);
  });
});

describe('buildGraph', () => {
  const claims = [
    proved('base', 'Base case n ≤ 4'),
    proved('parity', 'Parity reduction', ['base']),
    proved('even', 'Even step', ['parity']),
    open('tail', 'Tail bound', ['even']),
    open('goal', 'Goal', ['tail']),
  ];

  it('layers bottom-up so every edge goes up the page', () => {
    const graph = buildGraph(claims, { goal: asClaimId('goal'), pin });
    const layer = (id: string) => graph.nodes.find((n) => n.id === asClaimId(id))!.layer;
    expect(layer('base')).toBe(0);
    expect(layer('parity')).toBe(1);
    expect(layer('even')).toBe(2);
    expect(layer('goal')).toBe(4);
    for (const edge of graph.edges) {
      expect(layer(edge.from)).toBeLessThan(layer(edge.to));
    }
  });

  it('uses the longest path, not the shortest, so a shortcut cannot flatten the picture', () => {
    // goal cites both base (short hop) and even (long hop). The floor-to-goal
    // distance is what matters, so goal must sit above even.
    const withShortcut = [...claims.slice(0, 4), open('goal', 'Goal', ['tail', 'base'])];
    const graph = buildGraph(withShortcut, { goal: asClaimId('goal'), pin });
    const layer = (id: string) => graph.nodes.find((n) => n.id === asClaimId(id))!.layer;
    expect(layer('goal')).toBe(4);
  });

  it('marks the path from the floor to the goal as critical', () => {
    const graph = buildGraph(claims, { goal: asClaimId('goal'), pin });
    expect(graph.nodes.filter((n) => n.onCriticalPath).map((n) => n.id)).toHaveLength(5);
  });

  it('leaves side branches off the critical path', () => {
    const withAside = [...claims, open('aside', 'Unrelated lemma')];
    const graph = buildGraph(withAside, { goal: asClaimId('goal'), pin });
    expect(graph.nodes.find((n) => n.id === asClaimId('aside'))!.onCriticalPath).toBe(false);
  });

  it('reports every unproved node on the critical path as a blocker', () => {
    const graph = buildGraph(claims, { goal: asClaimId('goal'), pin });
    expect(graph.blockers).toEqual([asClaimId('goal'), asClaimId('tail')]);
  });

  it('invalidates everything downstream of a counterexample', () => {
    const withRefutation = [
      proved('base', 'Base case'),
      makeClaim(asClaimId('strong'), 'Strong form', 'strong', {
        elaborates: true,
        dependsOn: [asClaimId('base')],
        refutation,
      }),
      proved('corollary', 'Corollary', ['strong']),
    ];
    const graph = buildGraph(withRefutation, { goal: null, pin });
    const corollary = graph.nodes.find((n) => n.id === asClaimId('corollary'))!;
    expect(corollary.invalidated).toBe(true);
    expect(graph.edges.find((e) => e.from === asClaimId('strong'))!.dead).toBe(true);
    // The refuted node itself is a result, not a casualty of one.
    expect(graph.nodes.find((n) => n.id === asClaimId('strong'))!.invalidated).toBe(false);
  });

  it('reports cycles instead of hanging on them', () => {
    const cyclic = [open('a', 'A', ['b']), open('b', 'B', ['a'])];
    const graph = buildGraph(cyclic, { goal: null, pin });
    expect(graph.cycles.length).toBeGreaterThan(0);
    expect(graph.nodes).toHaveLength(2);
  });

  it('ignores citations of claims outside the workspace', () => {
    const graph = buildGraph([open('a', 'A', ['nonexistent'])], { goal: null, pin });
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes[0]!.layer).toBe(0);
  });

  it('handles a long chain without exhausting the call stack', () => {
    const chain = Array.from({ length: 12000 }, (_, i) =>
      open(`n${i}`, `n${i}`, i === 0 ? [] : [`n${i - 1}`]),
    );
    const graph = buildGraph(chain, { goal: null, pin });
    expect(graph.layerCount).toBe(12000);
  });
});
