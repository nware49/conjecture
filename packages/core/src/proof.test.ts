import { describe, expect, it } from 'vitest';
import { asGapId, asStepId } from './ids.js';
import { deriveStepStatuses, makeStep, proofProgress, type Gap } from './proof.js';

const gap = (id: string, stepId: string): Gap => ({
  id: asGapId(id),
  label: id,
  position: { line: 1, column: 0 },
  goal: null,
  stepId: asStepId(stepId),
});

describe('deriveStepStatuses', () => {
  it('marks a step with a hole in it as a gap, not as pending', () => {
    const steps = [makeStep(asStepId('s1'), 'one', { kernelOk: true })];
    const statuses = deriveStepStatuses(steps, [gap('g1', 's1')]);
    expect(statuses.get(asStepId('s1'))).toBe('gap');
  });

  it('blocks a step whose dependency is a gap', () => {
    const steps = [
      makeStep(asStepId('s1'), 'one'),
      makeStep(asStepId('s2'), 'two', { kernelOk: true, dependsOn: [asStepId('s1')] }),
    ];
    const statuses = deriveStepStatuses(steps, [gap('g1', 's1')]);
    expect(statuses.get(asStepId('s2'))).toBe('blocked');
  });

  it('propagates blocking transitively — three steps above a hole is still not proved', () => {
    const steps = [
      makeStep(asStepId('s1'), 'one'),
      makeStep(asStepId('s2'), 'two', { kernelOk: true, dependsOn: [asStepId('s1')] }),
      makeStep(asStepId('s3'), 'three', { kernelOk: true, dependsOn: [asStepId('s2')] }),
      makeStep(asStepId('s4'), 'four', { kernelOk: true, dependsOn: [asStepId('s3')] }),
    ];
    const statuses = deriveStepStatuses(steps, [gap('g1', 's1')]);
    expect(statuses.get(asStepId('s4'))).toBe('blocked');
  });

  it('verifies a step whose dependencies all landed', () => {
    const steps = [
      makeStep(asStepId('s1'), 'one', { kernelOk: true }),
      makeStep(asStepId('s2'), 'two', { kernelOk: true, dependsOn: [asStepId('s1')] }),
    ];
    const statuses = deriveStepStatuses(steps, []);
    expect(statuses.get(asStepId('s2'))).toBe('verified');
  });

  it('calls an unchecked step pending rather than verified', () => {
    const statuses = deriveStepStatuses([makeStep(asStepId('s1'), 'one')], []);
    expect(statuses.get(asStepId('s1'))).toBe('pending');
  });

  it('reports a dependency cycle as blocked instead of hanging', () => {
    const steps = [
      makeStep(asStepId('a'), 'a', { kernelOk: true, dependsOn: [asStepId('b')] }),
      makeStep(asStepId('b'), 'b', { kernelOk: true, dependsOn: [asStepId('a')] }),
    ];
    const statuses = deriveStepStatuses(steps, []);
    expect(statuses.get(asStepId('a'))).toBe('blocked');
    expect(statuses.get(asStepId('b'))).toBe('blocked');
  });

  it('ignores a dependency on a step that does not exist', () => {
    const steps = [makeStep(asStepId('s1'), 'one', { kernelOk: true, dependsOn: [asStepId('ghost')] })];
    expect(deriveStepStatuses(steps, []).get(asStepId('s1'))).toBe('blocked');
  });

  it('handles a deep chain without exhausting the call stack', () => {
    const steps = Array.from({ length: 20000 }, (_, i) =>
      makeStep(asStepId(`s${i}`), `step ${i}`, {
        kernelOk: true,
        dependsOn: i === 0 ? [] : [asStepId(`s${i - 1}`)],
      }),
    );
    const statuses = deriveStepStatuses(steps, []);
    expect(statuses.get(asStepId('s19999'))).toBe('verified');
  });
});

describe('proofProgress', () => {
  it('snaps the fill to eighths so the mark stays discrete', () => {
    const statuses = new Map([
      [asStepId('a'), 'verified' as const],
      [asStepId('b'), 'verified' as const],
      [asStepId('c'), 'gap' as const],
    ]);
    const progress = proofProgress(statuses);
    expect(progress.fraction).toBeCloseTo(2 / 3);
    expect(progress.octile).toBe(0.625);
    expect(progress.percent).toBe(66);
  });

  it('is zero, not NaN, for a claim with no steps', () => {
    const progress = proofProgress(new Map());
    expect(progress.fraction).toBe(0);
    expect(progress.percent).toBe(0);
    expect(progress.octile).toBe(0);
  });

  it('reaches a full square only when every step is verified', () => {
    const statuses = new Map([
      [asStepId('a'), 'verified' as const],
      [asStepId('b'), 'verified' as const],
    ]);
    expect(proofProgress(statuses).octile).toBe(1);
  });
});
