import { describe, expect, it } from 'vitest';
import {
  axiomLines,
  collectAxiomReports,
  extendedTrustNote,
  findAxiomReport,
  parseAxiomMessage,
} from './axioms.js';
import { parseJsonOutput } from './diagnostics.js';

describe('parseAxiomMessage', () => {
  it('parses the standard three', () => {
    const parsed = parseAxiomMessage(
      "'tail_bound' depends on axioms: [propext, Classical.choice, Quot.sound]",
    );
    expect(parsed?.declaration).toBe('tail_bound');
    expect(parsed?.report.standardOnly).toBe(true);
    expect(parsed?.report.axioms.map((a) => a.name)).toEqual([
      'propext',
      'Classical.choice',
      'Quot.sound',
    ]);
  });

  it('distinguishes "no axioms" from "we did not look"', () => {
    const parsed = parseAxiomMessage("'trivial_thm' does not depend on any axioms");
    expect(parsed).not.toBeNull();
    expect(parsed?.report.axioms).toEqual([]);
    expect(parsed?.report.standardOnly).toBe(true);
    expect(parseAxiomMessage('some unrelated message')).toBeNull();
  });

  it('flags native_decide pulling the compiler into the trusted base', () => {
    const parsed = parseAxiomMessage(
      "'big_check' depends on axioms: [propext, Classical.choice, Quot.sound, Lean.ofReduceBool]",
    );
    expect(parsed?.report.trustsCompiler).toBe(true);
  });

  it('flags a declaration that reaches sorryAx', () => {
    const parsed = parseAxiomMessage("'half_done' depends on axioms: [propext, sorryAx]");
    expect(parsed?.report.dependsOnSorry).toBe(true);
  });

  it('handles a dotted declaration name', () => {
    const parsed = parseAxiomMessage(
      "'TailBounds.Main.tail_bound' depends on axioms: [propext]",
    );
    expect(parsed?.declaration).toBe('TailBounds.Main.tail_bound');
  });

  it('handles a report split across lines', () => {
    const parsed = parseAxiomMessage(
      "'wide' depends on axioms: [propext,\n Classical.choice,\n Quot.sound]",
    );
    expect(parsed?.report.axioms).toHaveLength(3);
  });

  it('tolerates a name printed without surrounding quotes', () => {
    expect(parseAxiomMessage('tail_bound depends on axioms: [propext]')?.declaration).toBe(
      'tail_bound',
    );
  });
});

describe('findAxiomReport', () => {
  const output = [
    JSON.stringify({ severity: 'warning', data: "declaration uses 'sorry'" }),
    JSON.stringify({
      severity: 'information',
      data: "'tail_bound' depends on axioms: [propext, Classical.choice, Quot.sound]",
    }),
  ].join('\n');

  it('finds the report for the declaration under test', () => {
    const { diagnostics } = parseJsonOutput(output);
    expect(findAxiomReport(diagnostics, 'tail_bound')?.standardOnly).toBe(true);
  });

  it('matches a declaration reported under its full namespace', () => {
    const { diagnostics } = parseJsonOutput(
      JSON.stringify({
        severity: 'information',
        data: "'TailBounds.tail_bound' depends on axioms: [propext]",
      }),
    );
    expect(findAxiomReport(diagnostics, 'tail_bound')).not.toBeNull();
  });

  it('returns null when nothing reported on that declaration', () => {
    const { diagnostics } = parseJsonOutput(output);
    expect(findAxiomReport(diagnostics, 'other_thm')).toBeNull();
  });

  it('collects every report in a run', () => {
    const { diagnostics } = parseJsonOutput(
      [
        JSON.stringify({ severity: 'information', data: "'a' depends on axioms: [propext]" }),
        JSON.stringify({ severity: 'information', data: "'b' does not depend on any axioms" }),
      ].join('\n'),
    );
    const all = collectAxiomReports(diagnostics);
    expect([...all.keys()]).toEqual(['a', 'b']);
  });
});

describe('display helpers', () => {
  it('lists axioms as plain lines, not badges', () => {
    const report = parseAxiomMessage("'t' depends on axioms: [propext, Quot.sound]")!.report;
    expect(axiomLines(report)).toEqual(['propext', 'Quot.sound']);
  });

  it('says so when a declaration depends on nothing at all', () => {
    const report = parseAxiomMessage("'t' does not depend on any axioms")!.report;
    expect(axiomLines(report)).toEqual(['depends on no axioms']);
  });

  it('stays quiet for the standard three', () => {
    const report = parseAxiomMessage(
      "'t' depends on axioms: [propext, Classical.choice, Quot.sound]",
    )!.report;
    expect(extendedTrustNote(report)).toBeNull();
  });

  it('names native_decide and how to remove it', () => {
    const report = parseAxiomMessage("'t' depends on axioms: [Lean.ofReduceBool]")!.report;
    expect(extendedTrustNote(report)).toContain('native_decide');
    expect(extendedTrustNote(report)).toContain('decide');
  });

  it('leads with sorryAx, because that outranks every other caveat', () => {
    const report = parseAxiomMessage(
      "'t' depends on axioms: [sorryAx, Lean.ofReduceBool, My.axiom]",
    )!.report;
    expect(extendedTrustNote(report)).toContain('not proved');
  });

  it('names custom axioms individually', () => {
    const report = parseAxiomMessage("'t' depends on axioms: [propext, My.assumption]")!.report;
    expect(extendedTrustNote(report)).toContain('My.assumption');
  });
});
