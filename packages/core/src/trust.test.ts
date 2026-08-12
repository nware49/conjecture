import { describe, expect, it } from 'vitest';
import {
  classifyAxiom,
  classifyTrust,
  reportAxioms,
  trustSummary,
  isProvedRung,
  STANDARD_AXIOMS,
} from './trust.js';

describe('classifyAxiom', () => {
  it('recognises the three standard axioms', () => {
    for (const name of STANDARD_AXIOMS) {
      expect(classifyAxiom(name)).toBe('standard');
    }
  });

  it('recognises the compiler-trust axioms native_decide introduces', () => {
    expect(classifyAxiom('Lean.ofReduceBool')).toBe('compiler-trust');
    expect(classifyAxiom('Lean.trustCompiler')).toBe('compiler-trust');
  });

  it('recognises sorryAx', () => {
    expect(classifyAxiom('sorryAx')).toBe('sorry');
  });

  it('treats anything else as a custom axiom that has to be surfaced', () => {
    expect(classifyAxiom('MyProject.bigAssumption')).toBe('custom');
  });
});

describe('reportAxioms', () => {
  it('reports the standard set as standard-only', () => {
    const report = reportAxioms([...STANDARD_AXIOMS]);
    expect(report.standardOnly).toBe(true);
    expect(report.trustsCompiler).toBe(false);
    expect(report.dependsOnSorry).toBe(false);
    expect(report.custom).toEqual([]);
  });

  it('flags a compiler-trust axiom without losing the standard ones', () => {
    const report = reportAxioms([...STANDARD_AXIOMS, 'Lean.ofReduceBool']);
    expect(report.trustsCompiler).toBe(true);
    expect(report.standardOnly).toBe(false);
    expect(report.axioms).toHaveLength(4);
  });

  it('flags sorryAx', () => {
    const report = reportAxioms(['propext', 'sorryAx']);
    expect(report.dependsOnSorry).toBe(true);
  });

  it('collects custom axioms by name', () => {
    const report = reportAxioms(['propext', 'Foo.assume', 'Bar.assume']);
    expect(report.custom).toEqual(['Foo.assume', 'Bar.assume']);
  });

  it('treats an empty axiom list as standard-only', () => {
    // `#print axioms` printing "does not depend on any axioms" is the strongest
    // possible result, not a missing one.
    expect(reportAxioms([]).standardOnly).toBe(true);
  });
});

describe('classifyTrust', () => {
  const base = { elaborates: true, sorryCount: 0, kernelAccepted: false };

  it('puts prose-only claims on rung 1', () => {
    expect(classifyTrust({ ...base, elaborates: false })).toBe(1);
  });

  it('puts a statement that merely elaborates on rung 2', () => {
    expect(classifyTrust(base)).toBe(2);
  });

  it('puts a skeleton with holes on rung 3', () => {
    expect(classifyTrust({ ...base, sorryCount: 2 })).toBe(3);
  });

  it('reaches rung 4 only when the kernel accepted a term', () => {
    expect(classifyTrust({ ...base, kernelAccepted: true })).toBe(4);
  });

  it('reaches rung 5 when the axioms are the standard three', () => {
    expect(
      classifyTrust({
        ...base,
        kernelAccepted: true,
        axioms: reportAxioms([...STANDARD_AXIOMS]),
      }),
    ).toBe(5);
  });

  it('reports rung 6 when native_decide put the compiler in the trusted base', () => {
    expect(
      classifyTrust({
        ...base,
        kernelAccepted: true,
        axioms: reportAxioms([...STANDARD_AXIOMS, 'Lean.ofReduceBool']),
      }),
    ).toBe(6);
  });

  it('holds a custom-axiom proof at rung 4 rather than promoting it to 5', () => {
    expect(
      classifyTrust({
        ...base,
        kernelAccepted: true,
        axioms: reportAxioms(['propext', 'Project.unproved']),
      }),
    ).toBe(4);
  });

  it('demotes to rung 3 when the axiom report reaches sorryAx, whatever the build said', () => {
    // This is the case that matters most: a build can report success while the
    // declaration transitively depends on a hole.
    expect(
      classifyTrust({
        elaborates: true,
        sorryCount: 0,
        kernelAccepted: true,
        axioms: reportAxioms(['propext', 'sorryAx']),
      }),
    ).toBe(3);
  });

  it('never promotes an unelaborated claim, even with a receipt attached', () => {
    expect(
      classifyTrust({
        elaborates: false,
        sorryCount: 0,
        kernelAccepted: true,
        axioms: reportAxioms([...STANDARD_AXIOMS]),
      }),
    ).toBe(1);
  });
});

describe('isProvedRung', () => {
  it('is true from rung 4 up, including the compiler-trust rung', () => {
    expect([1, 2, 3].map((r) => isProvedRung(r as 1 | 2 | 3))).toEqual([false, false, false]);
    expect([4, 5, 6].map((r) => isProvedRung(r as 4 | 5 | 6))).toEqual([true, true, true]);
  });
});

describe('trustSummary', () => {
  it('counts sorries exactly rather than rounding them away', () => {
    const evidence = { elaborates: true, sorryCount: 3, kernelAccepted: false };
    expect(trustSummary(3, evidence)).toBe('3 sorry');
  });

  it('names custom axioms in the summary', () => {
    const evidence = {
      elaborates: true,
      sorryCount: 0,
      kernelAccepted: true,
      axioms: reportAxioms(['propext', 'Project.unproved']),
    };
    expect(trustSummary(4, evidence)).toBe('proved · 1 custom axiom');
  });
});
