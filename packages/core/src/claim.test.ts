import { describe, expect, it } from 'vitest';
import { deriveClaimView, groupByState, makeClaim } from './claim.js';
import { asClaimId, asGapId, asStepId } from './ids.js';
import { makeStep, type Gap } from './proof.js';
import type { Pin, Receipt } from './receipt.js';
import { reportAxioms, STANDARD_AXIOMS } from './trust.js';
import type { Refutation } from './witness.js';

const pin: Pin = {
  toolchain: 'leanprover/lean4:v4.9.0',
  mathlibRev: 'a1b2c3d',
  dependencies: { mathlib: 'a1b2c3d' },
  capturedAt: '2026-01-01T00:00:00.000Z',
};

const cleanReceipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  engine: 'lean-process',
  method: 'lean-kernel',
  scope: null,
  declaration: 'tail_bound',
  pin,
  axioms: reportAxioms([...STANDARD_AXIOMS]),
  sorryCount: 0,
  accepted: true,
  elapsedMs: 1800,
  heartbeats: { used: 31000, budget: 200000 },
  verifiedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const gap = (id: string, stepId: string | null): Gap => ({
  id: asGapId(id),
  label: id,
  position: { line: 7, column: 5 },
  goal: null,
  stepId: stepId === null ? null : asStepId(stepId),
});

describe('deriveClaimView', () => {
  it('reports a bare claim as open with a hollow mark', () => {
    const view = deriveClaimView(makeClaim(asClaimId('c1'), 'A claim', 'a_claim'), pin);
    expect(view.state).toBe('open');
    expect(view.mark).toBe('open');
    expect(view.fill).toBe(0);
  });

  it('keeps a claim open once it elaborates but has no proof', () => {
    const claim = makeClaim(asClaimId('c1'), 'A claim', 'a_claim', { elaborates: true });
    const view = deriveClaimView(claim, pin);
    expect(view.state).toBe('open');
    expect(view.rung).toBe(2);
    expect(view.summary).toBe('open · typed');
  });

  it('fills the mark only when the kernel accepted a term', () => {
    const claim = makeClaim(asClaimId('c1'), 'Tail bound', 'tail_bound', {
      elaborates: true,
      steps: [makeStep(asStepId('s1'), 'step', { kernelOk: true })],
      receipt: cleanReceipt(),
    });
    const view = deriveClaimView(claim, pin);
    expect(view.state).toBe('proved');
    expect(view.fill).toBe(1);
    expect(view.rung).toBe(5);
    expect(view.summary).toBe('proved · 0 sorry · kernel-checked in 1.8s · 3 axioms');
  });

  it('refuses to call a claim proved when the engine said so but the axioms reach sorryAx', () => {
    const claim = makeClaim(asClaimId('c1'), 'Tail bound', 'tail_bound', {
      elaborates: true,
      steps: [makeStep(asStepId('s1'), 'step', { kernelOk: true })],
      receipt: cleanReceipt({ axioms: reportAxioms(['propext', 'sorryAx']) }),
    });
    const view = deriveClaimView(claim, pin);
    expect(view.state).not.toBe('proved');
    expect(view.rung).toBe(3);
  });

  it('marks a proof stale after a Mathlib bump rather than dropping or keeping it', () => {
    const claim = makeClaim(asClaimId('c1'), 'Tail bound', 'tail_bound', {
      elaborates: true,
      steps: [makeStep(asStepId('s1'), 'step', { kernelOk: true })],
      receipt: cleanReceipt(),
    });
    const view = deriveClaimView(claim, {
      ...pin,
      mathlibRev: 'ffffff',
      dependencies: { mathlib: 'ffffff' },
    });
    expect(view.state).toBe('stale');
    expect(view.mark).toBe('stale');
    // The revision is reported once, not once per place it is recorded.
    expect(view.staleness).toEqual([
      { field: 'mathlib', name: 'Mathlib', was: 'a1b2c3d', now: 'ffffff' },
    ]);
    expect(view.summary).toContain('stale');
  });

  it('reports in-progress with an exact sorry count and an eighths-snapped fill', () => {
    const steps = [
      makeStep(asStepId('s1'), 'one', { kernelOk: true }),
      makeStep(asStepId('s2'), 'two', { kernelOk: true }),
      makeStep(asStepId('s3'), 'three'),
      makeStep(asStepId('s4'), 'four', { dependsOn: [asStepId('s3')] }),
    ];
    const claim = makeClaim(asClaimId('c1'), 'Tail bound', 'tail_bound', {
      elaborates: true,
      steps,
      gaps: [gap('g3', 's3')],
    });
    const view = deriveClaimView(claim, pin);
    expect(view.state).toBe('in_progress');
    expect(view.progress.verified).toBe(2);
    expect(view.progress.percent).toBe(50);
    expect(view.fill).toBe(0.5);
    expect(view.summary).toBe('50% verified · 1 sorry');
  });

  it('floors the percentage so an almost-finished proof never reads as finished', () => {
    const steps = Array.from({ length: 300 }, (_, i) =>
      makeStep(asStepId(`s${i}`), `step ${i}`, { kernelOk: i > 0 }),
    );
    const claim = makeClaim(asClaimId('c1'), 'Long', 'long', {
      elaborates: true,
      steps,
      gaps: [gap('g0', 's0')],
    });
    const view = deriveClaimView(claim, pin);
    expect(view.progress.fraction).toBeGreaterThan(0.996);
    expect(view.progress.percent).toBe(99);
  });

  it('lets a counterexample end the argument regardless of proof progress', () => {
    const refutation: Refutation = {
      witness: { assignment: { n: '40' }, evaluation: '40^2 + 40 + 41 = 1681 = 41 * 41' },
      authority: 'computed',
      confirmationTerm: null,
      searchId: null,
      candidatesChecked: 41,
      elapsedMs: 3,
      foundAt: '2026-01-01T00:00:00.000Z',
    };
    const claim = makeClaim(asClaimId('c1'), 'Euler polynomial', 'euler_poly', {
      elaborates: true,
      steps: [makeStep(asStepId('s1'), 'step', { kernelOk: true })],
      receipt: cleanReceipt(),
      refutation,
    });
    const view = deriveClaimView(claim, pin);
    expect(view.state).toBe('refuted');
    expect(view.fill).toBe(0);
    expect(view.summary).toBe('refuted · n=40 · search only');
  });

  it('says out loud when a witness has not been kernel-confirmed', () => {
    const refutation: Refutation = {
      witness: { assignment: { p: '11' }, evaluation: '2^11 - 1 = 2047 = 23 * 89' },
      authority: 'kernel-confirmed',
      confirmationTerm: 'example : ¬ Nat.Prime (2^11 - 1) := by decide',
      searchId: null,
      candidatesChecked: 5,
      elapsedMs: 1,
      foundAt: '2026-01-01T00:00:00.000Z',
    };
    const claim = makeClaim(asClaimId('c1'), 'Mersenne', 'mersenne', { refutation });
    expect(deriveClaimView(claim, pin).summary).toBe('refuted · p=11 · kernel-confirmed');
  });

  it('proves a bounded claim by exhaustion, and always names the scope', () => {
    const claim = makeClaim(asClaimId('c1'), 'Collatz below 100k', 'collatz_small', {
      steps: [makeStep(asStepId('s1'), 'exhaust the space', { kernelOk: true })],
      receipt: cleanReceipt({
        engine: 'exhaustive-search',
        method: 'exhaustion',
        scope: 'n ∈ [1, 100000] · 100,000 candidates',
        axioms: reportAxioms([]),
        elapsedMs: 900,
      }),
    });
    const view = deriveClaimView(claim, pin);
    expect(view.state).toBe('proved');
    expect(view.method).toBe('exhaustion');
    expect(view.summary).toBe('proved by exhaustion · n ∈ [1, 100000] · 100,000 candidates · 0.9s');
    // The scope is in the summary itself, so a reader cannot lift the result
    // out of its bound by accident.
    expect(view.summary).toContain('100000');
  });

  it('keeps an exhaustion result off the Lean trust ladder entirely', () => {
    const claim = makeClaim(asClaimId('c1'), 'Collatz below 100k', 'collatz_small', {
      elaborates: true,
      steps: [makeStep(asStepId('s1'), 'exhaust', { kernelOk: true })],
      receipt: cleanReceipt({
        engine: 'exhaustive-search',
        method: 'exhaustion',
        scope: 'n ∈ [1, 100000]',
        axioms: reportAxioms([]),
      }),
    });
    const view = deriveClaimView(claim, pin);
    // Rung 2 — the statement elaborated, and that is all Lean ever said about
    // it. It must never read as rung 5 "proved, standard axioms".
    expect(view.rung).toBe(2);
    expect(view.state).toBe('proved');
  });

  it('keeps every square hollow when no project is pinned', () => {
    const claim = makeClaim(asClaimId('c1'), 'Tail bound', 'tail_bound', {
      elaborates: true,
      steps: [makeStep(asStepId('s1'), 'step', { kernelOk: true })],
      receipt: cleanReceipt(),
    });
    // No pin means no environment to be current against, so nothing is proved.
    expect(deriveClaimView(claim, null).state).not.toBe('proved');
  });
});

describe('groupByState', () => {
  it('groups the library into the glyph buckets, preserving order', () => {
    const claims = [
      makeClaim(asClaimId('a'), 'Open one', 'open_one'),
      makeClaim(asClaimId('b'), 'Proved one', 'proved_one', {
        elaborates: true,
        steps: [makeStep(asStepId('s'), 'x', { kernelOk: true })],
        receipt: cleanReceipt({ declaration: 'proved_one' }),
      }),
    ];
    const groups = groupByState(claims, pin);
    expect(groups.get('open')).toHaveLength(1);
    expect(groups.get('proved')).toHaveLength(1);
    expect(groups.get('refuted')).toHaveLength(0);
    expect([...groups.keys()]).toEqual(['open', 'in_progress', 'proved', 'stale', 'refuted']);
  });
});
