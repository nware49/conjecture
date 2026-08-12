/**
 * Lean diagnostics.
 *
 * Messages are shown at the source position Lean reported, in Lean's own
 * words. Nothing here rephrases a diagnostic into friendlier English — this
 * audience reads Lean's messages all day, and a paraphrase is a place for an
 * error to hide. Classification exists only so the interface knows which
 * control to offer next.
 */

import type { SourcePos, SourceRange } from '@conjecture/core';

export type Severity = 'error' | 'warning' | 'information';

/** One message as `lake env lean --json` emits it, one object per line. */
export interface LeanJsonMessage {
  readonly severity?: string;
  readonly pos?: { line?: number; column?: number };
  readonly endPos?: { line?: number; column?: number } | null;
  readonly data?: string;
  readonly fileName?: string;
  readonly caption?: string;
}

/**
 * The conditions the interface has to name precisely. Anything unrecognised
 * stays `other` and is shown verbatim rather than guessed at.
 */
export type LeanCondition =
  | 'sorry'
  | 'unsolved-goals'
  | 'unknown-identifier'
  | 'unknown-constant'
  | 'deterministic-timeout'
  | 'max-recursion'
  | 'type-mismatch'
  | 'function-expected'
  | 'axiom-report'
  | 'other';

export interface Diagnostic {
  readonly severity: Severity;
  readonly condition: LeanCondition;
  readonly range: SourceRange;
  /** Lean's own text, unedited. */
  readonly message: string;
  readonly file: string | null;
}

/**
 * What the interface does about each condition. This is the design's failure
 * table, in code, so the two cannot drift apart.
 */
export interface ConditionResponse {
  /** One line, in the house voice. */
  readonly headline: string;
  /** Does this change the claim's state, or only what is on screen? */
  readonly effect: 'in-progress' | 'unchanged' | 'blocked';
  /** The control to offer, if any. */
  readonly action: string | null;
}

export const CONDITION_RESPONSE: Readonly<Record<LeanCondition, ConditionResponse>> = {
  sorry: {
    headline: "declaration uses 'sorry'",
    effect: 'in-progress',
    action: 'Open the gap',
  },
  'unsolved-goals': {
    headline: 'The tactic block ended with the goal still open.',
    effect: 'in-progress',
    action: 'Show the remaining goal',
  },
  'unknown-identifier': {
    headline: 'That name does not resolve against the pinned Mathlib revision.',
    effect: 'unchanged',
    action: 'Search for a real declaration',
  },
  'unknown-constant': {
    headline: 'That constant does not exist in the pinned environment.',
    effect: 'unchanged',
    action: 'Search for a real declaration',
  },
  'deterministic-timeout': {
    headline: 'Elaboration hit its heartbeat budget.',
    effect: 'unchanged',
    action: 'Raise the budget, or split the goal into cases',
  },
  'max-recursion': {
    headline: 'Elaboration hit the recursion depth limit.',
    effect: 'unchanged',
    action: 'Raise maxRecDepth, or restructure the term',
  },
  'type-mismatch': {
    headline: 'Type mismatch at this step. Earlier steps are unaffected.',
    effect: 'unchanged',
    action: null,
  },
  'function-expected': {
    headline: 'Too many arguments were applied here.',
    effect: 'unchanged',
    action: null,
  },
  'axiom-report': {
    headline: 'Axiom report from #print axioms.',
    effect: 'unchanged',
    action: null,
  },
  other: {
    headline: 'Lean reported a message.',
    effect: 'unchanged',
    action: null,
  },
};

export function classifyDiagnostic(message: string): LeanCondition {
  const text = message.trim();
  if (/declaration uses ['`']sorry['`']/.test(text)) return 'sorry';
  if (text.startsWith('unsolved goals')) return 'unsolved-goals';
  if (/^unknown identifier/.test(text)) return 'unknown-identifier';
  if (/^unknown constant/.test(text)) return 'unknown-constant';
  // Lean writes "(deterministic) timeout at `whnf`, maximum number of
  // heartbeats (200000) has been reached" — the parentheses are part of it.
  if (/\(?deterministic\)?\s+timeout|maximum number of heartbeats/i.test(text)) {
    return 'deterministic-timeout';
  }
  if (/maximum recursion depth/i.test(text)) return 'max-recursion';
  if (/^type mismatch/.test(text)) return 'type-mismatch';
  if (/^function expected/.test(text)) return 'function-expected';
  if (/depends on axioms|does not depend on any axioms/.test(text)) return 'axiom-report';
  return 'other';
}

function toSeverity(raw: string | undefined): Severity {
  switch (raw) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'information';
  }
}

function toPos(raw: { line?: number; column?: number } | null | undefined): SourcePos {
  return { line: raw?.line ?? 1, column: raw?.column ?? 0 };
}

export function toDiagnostic(message: LeanJsonMessage): Diagnostic {
  const text = message.data ?? '';
  const start = toPos(message.pos);
  return {
    severity: toSeverity(message.severity),
    condition: classifyDiagnostic(text),
    range: { start, end: message.endPos ? toPos(message.endPos) : start },
    message: text,
    file: message.fileName ?? null,
  };
}

/**
 * Parse `lake env lean --json` output.
 *
 * Lean writes one JSON object per line, but a build can interleave plain text
 * on the same stream, so unparseable lines are collected rather than thrown
 * away — losing a line here would mean losing an error.
 */
export function parseJsonOutput(output: string): {
  diagnostics: Diagnostic[];
  unparsed: string[];
} {
  const diagnostics: Diagnostic[] = [];
  const unparsed: string[] = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (!trimmed.startsWith('{')) {
      unparsed.push(trimmed);
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as LeanJsonMessage;
      diagnostics.push(toDiagnostic(parsed));
    } catch {
      unparsed.push(trimmed);
    }
  }

  return { diagnostics, unparsed };
}

export interface GoalState {
  /** Hypotheses above the turnstile, verbatim. */
  readonly hypotheses: readonly string[];
  /** The goal after the turnstile, verbatim. */
  readonly goal: string;
  readonly position: SourcePos;
  /** The whole block as Lean printed it, for panels that show it raw. */
  readonly raw: string;
}

const TURNSTILE = '⊢';

/**
 * Pull goal states out of an "unsolved goals" message.
 *
 * Lean prints the hypotheses, then a line beginning with the turnstile. This is
 * the one panel in the product the model is not allowed to write, so the
 * parser's only job is to split the text — never to summarise it.
 */
export function parseGoals(diagnostic: Diagnostic): GoalState[] {
  if (diagnostic.condition !== 'unsolved-goals') return [];

  const body = diagnostic.message.replace(/^unsolved goals\s*\n?/, '');
  if (body.trim().length === 0) return [];

  const goals: GoalState[] = [];
  // Multiple goals are separated by a blank line.
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0);
    const turnstileAt = lines.findIndex((line) => line.trimStart().startsWith(TURNSTILE));
    if (turnstileAt === -1) continue;
    goals.push({
      hypotheses: lines.slice(0, turnstileAt),
      goal: lines
        .slice(turnstileAt)
        .join('\n')
        .replace(/^\s*⊢\s*/, ''),
      position: diagnostic.range.start,
      raw: block.trim(),
    });
  }
  return goals;
}

export interface SorryHole {
  readonly position: SourcePos;
  readonly range: SourceRange;
}

/**
 * Where the holes are.
 *
 * Lean reports one `declaration uses 'sorry'` per declaration, positioned at
 * the declaration name — not once per hole — so the count comes from the source
 * text and the diagnostics only confirm that at least one exists.
 */
export function findSorries(source: string, diagnostics: readonly Diagnostic[]): SorryHole[] {
  const declared = diagnostics.some((d) => d.condition === 'sorry');
  const holes: SorryHole[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const withoutComment = line.replace(/--.*$/, '');
    const pattern = /\bsorry\b/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(withoutComment)) !== null) {
      const start = { line: i + 1, column: match.index };
      holes.push({
        position: start,
        range: { start, end: { line: i + 1, column: match.index + 'sorry'.length } },
      });
    }
  }

  // If Lean says there is a hole but the text has none, the hole came from a
  // macro or an imported declaration. Record one at the reported position
  // rather than reporting zero and calling the proof complete.
  if (holes.length === 0 && declared) {
    const reported = diagnostics.find((d) => d.condition === 'sorry')!;
    holes.push({ position: reported.range.start, range: reported.range });
  }

  return holes;
}
