import { describe, expect, it } from 'vitest';
import {
  CONDITION_RESPONSE,
  classifyDiagnostic,
  findSorries,
  parseGoals,
  parseJsonOutput,
  toDiagnostic,
} from './diagnostics.js';

/**
 * These strings are the shapes `lake env lean --json` actually emits. They are
 * the contract between this package and Lean, so they are written out in full
 * rather than abbreviated.
 */
const SORRY_LINE = JSON.stringify({
  severity: 'warning',
  pos: { line: 3, column: 8 },
  endPos: { line: 3, column: 18 },
  data: "declaration uses 'sorry'",
  fileName: '/proj/.conjecture/Scratch.lean',
});

const UNSOLVED_LINE = JSON.stringify({
  severity: 'error',
  pos: { line: 9, column: 2 },
  endPos: { line: 9, column: 7 },
  data: 'unsolved goals\nk : ℕ\nih : f k ≤ 2 * k\nh : ¬Even k\n⊢ f (k + 1) ≤ 2 * (k + 1)',
  fileName: '/proj/.conjecture/Scratch.lean',
});

const UNKNOWN_ID_LINE = JSON.stringify({
  severity: 'error',
  pos: { line: 12, column: 10 },
  data: "unknown identifier 'Nat.odd_succ_le'",
  fileName: '/proj/.conjecture/Scratch.lean',
});

const TIMEOUT_LINE = JSON.stringify({
  severity: 'error',
  pos: { line: 14, column: 4 },
  data: "(deterministic) timeout at `whnf`, maximum number of heartbeats (200000) has been reached\nuse `set_option maxHeartbeats <num>` to set the limit",
  fileName: '/proj/.conjecture/Scratch.lean',
});

const MISMATCH_LINE = JSON.stringify({
  severity: 'error',
  pos: { line: 7, column: 11 },
  data: 'type mismatch\n  even_step k h\nhas type\n  ℤ : Type\nbut is expected to have type\n  ℕ : Type',
  fileName: '/proj/.conjecture/Scratch.lean',
});

const AXIOM_LINE = JSON.stringify({
  severity: 'information',
  pos: { line: 20, column: 0 },
  data: "'tail_bound' depends on axioms: [propext, Classical.choice, Quot.sound]",
  fileName: '/proj/.conjecture/Scratch.lean',
});

describe('classifyDiagnostic', () => {
  it('recognises each condition the interface has to name', () => {
    expect(classifyDiagnostic("declaration uses 'sorry'")).toBe('sorry');
    expect(classifyDiagnostic('unsolved goals\n⊢ True')).toBe('unsolved-goals');
    expect(classifyDiagnostic("unknown identifier 'foo'")).toBe('unknown-identifier');
    expect(classifyDiagnostic("unknown constant 'Foo.bar'")).toBe('unknown-constant');
    expect(classifyDiagnostic('(deterministic) timeout at `whnf`')).toBe('deterministic-timeout');
    expect(classifyDiagnostic('maximum recursion depth has been reached')).toBe('max-recursion');
    expect(classifyDiagnostic('type mismatch\n  foo')).toBe('type-mismatch');
    expect(classifyDiagnostic('function expected at\n  f')).toBe('function-expected');
    expect(classifyDiagnostic("'t' does not depend on any axioms")).toBe('axiom-report');
  });

  it('leaves anything unfamiliar as other, to be shown verbatim', () => {
    expect(classifyDiagnostic('some future Lean message')).toBe('other');
    expect(CONDITION_RESPONSE.other.action).toBeNull();
  });

  it('only lets sorry and unsolved goals move a claim toward in-progress', () => {
    const moving = Object.entries(CONDITION_RESPONSE)
      .filter(([, response]) => response.effect === 'in-progress')
      .map(([condition]) => condition);
    expect(moving.sort()).toEqual(['sorry', 'unsolved-goals']);
  });
});

describe('parseJsonOutput', () => {
  it('parses one message per line', () => {
    const { diagnostics } = parseJsonOutput([SORRY_LINE, UNKNOWN_ID_LINE].join('\n'));
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]!.condition).toBe('sorry');
    expect(diagnostics[0]!.severity).toBe('warning');
    expect(diagnostics[1]!.condition).toBe('unknown-identifier');
    expect(diagnostics[1]!.range.start).toEqual({ line: 12, column: 10 });
  });

  it('keeps non-JSON lines instead of discarding them', () => {
    const { diagnostics, unparsed } = parseJsonOutput(
      ['info: building TailBounds', SORRY_LINE, 'error: something from lake'].join('\n'),
    );
    expect(diagnostics).toHaveLength(1);
    expect(unparsed).toEqual(['info: building TailBounds', 'error: something from lake']);
  });

  it('survives a truncated JSON line without losing the rest', () => {
    const { diagnostics, unparsed } = parseJsonOutput(
      ['{"severity":"error","data":"trunc', SORRY_LINE].join('\n'),
    );
    expect(diagnostics).toHaveLength(1);
    expect(unparsed).toHaveLength(1);
  });

  it('defaults a message with no position to the start of the file', () => {
    const { diagnostics } = parseJsonOutput('{"severity":"error","data":"no position"}');
    expect(diagnostics[0]!.range.start).toEqual({ line: 1, column: 0 });
    expect(diagnostics[0]!.range.end).toEqual({ line: 1, column: 0 });
  });

  it('treats an unrecognised severity as information rather than an error', () => {
    const diagnostic = toDiagnostic({ severity: 'trace', data: 'noise' });
    expect(diagnostic.severity).toBe('information');
  });
});

describe('parseGoals', () => {
  it('splits hypotheses from the goal without touching either', () => {
    const { diagnostics } = parseJsonOutput(UNSOLVED_LINE);
    const goals = parseGoals(diagnostics[0]!);
    expect(goals).toHaveLength(1);
    expect(goals[0]!.hypotheses).toEqual(['k : ℕ', 'ih : f k ≤ 2 * k', 'h : ¬Even k']);
    expect(goals[0]!.goal).toBe('f (k + 1) ≤ 2 * (k + 1)');
    expect(goals[0]!.raw).toContain('⊢');
  });

  it('parses several goals separated by a blank line', () => {
    const { diagnostics } = parseJsonOutput(
      JSON.stringify({
        severity: 'error',
        pos: { line: 4, column: 2 },
        data: 'unsolved goals\ncase zero\n⊢ f 0 ≤ 0\n\ncase succ\nk : ℕ\n⊢ f (k+1) ≤ 2*(k+1)',
      }),
    );
    const goals = parseGoals(diagnostics[0]!);
    expect(goals).toHaveLength(2);
    expect(goals[0]!.goal).toBe('f 0 ≤ 0');
    expect(goals[1]!.hypotheses).toEqual(['case succ', 'k : ℕ']);
  });

  it('returns nothing for a diagnostic that is not about goals', () => {
    const { diagnostics } = parseJsonOutput(UNKNOWN_ID_LINE);
    expect(parseGoals(diagnostics[0]!)).toEqual([]);
  });

  it('returns nothing rather than guessing when no turnstile is present', () => {
    const { diagnostics } = parseJsonOutput(
      JSON.stringify({ severity: 'error', data: 'unsolved goals\nnothing useful here' }),
    );
    expect(parseGoals(diagnostics[0]!)).toEqual([]);
  });
});

describe('findSorries', () => {
  const source = [
    'theorem tail_bound (n : ℕ) : f n ≤ 2 * n := by',
    '  induction n with',
    '  | zero => simp [f]',
    '  | succ k ih =>',
    '    rcases parity k with h | h',
    '    · exact even_step k h ih',
    '    · sorry  -- gap 3',
  ].join('\n');

  it('finds each hole in the source with its position', () => {
    const holes = findSorries(source, []);
    expect(holes).toHaveLength(1);
    expect(holes[0]!.position).toEqual({ line: 7, column: 6 });
  });

  it('ignores the word sorry inside a comment', () => {
    const holes = findSorries('-- sorry, this is prose\ntheorem t : True := trivial', []);
    expect(holes).toEqual([]);
  });

  it('does not match sorry inside a longer identifier', () => {
    expect(findSorries('def sorryHelper := 1', [])).toEqual([]);
  });

  it('records a hole Lean reported even when the text has none', () => {
    // A `sorry` reached through a macro or an imported declaration. Reporting
    // zero here would let an incomplete proof read as finished.
    const { diagnostics } = parseJsonOutput(SORRY_LINE);
    const holes = findSorries('theorem t : True := by my_macro', diagnostics);
    expect(holes).toHaveLength(1);
    expect(holes[0]!.position).toEqual({ line: 3, column: 8 });
  });

  it('counts several holes on one line', () => {
    expect(findSorries('example : True ∧ True := ⟨sorry, sorry⟩', [])).toHaveLength(2);
  });
});

describe('the failure table', () => {
  it('offers a raise-and-retry control for a heartbeat timeout', () => {
    const { diagnostics } = parseJsonOutput(TIMEOUT_LINE);
    const response = CONDITION_RESPONSE[diagnostics[0]!.condition];
    expect(response.action).toContain('Raise the budget');
    expect(response.effect).toBe('unchanged');
  });

  it('leaves a type mismatch without changing the claim state', () => {
    const { diagnostics } = parseJsonOutput(MISMATCH_LINE);
    expect(CONDITION_RESPONSE[diagnostics[0]!.condition].effect).toBe('unchanged');
    // The message keeps Lean's own expected-vs-got wording.
    expect(diagnostics[0]!.message).toContain('but is expected to have type');
  });

  it('recognises an axiom report as information, not a failure', () => {
    const { diagnostics } = parseJsonOutput(AXIOM_LINE);
    expect(diagnostics[0]!.severity).toBe('information');
    expect(diagnostics[0]!.condition).toBe('axiom-report');
  });
});
