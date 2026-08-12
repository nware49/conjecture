/**
 * Errors carry a source position wherever one exists. A search that fails
 * because of a typo on line 3 should say "line 3", not "something went wrong".
 */

export interface Position {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly position: Position | null,
  ) {
    super(message);
    this.name = 'SourceError';
  }

  /** "3:12 unexpected ')'" — the shape Lean users already read all day. */
  override toString(): string {
    return this.position
      ? `${this.position.line}:${this.position.column} ${this.message}`
      : this.message;
  }
}

export class LexError extends SourceError {
  override name = 'LexError';
}

export class ParseError extends SourceError {
  override name = 'ParseError';
}

export class EvalError extends SourceError {
  override name = 'EvalError';
}

/**
 * Thrown when a computation runs past its declared budget. Distinct from
 * EvalError because "we stopped looking" is a different claim from "this is
 * wrong", and the interface must not conflate them.
 */
export class BudgetExceeded extends Error {
  constructor(
    readonly kind: 'steps' | 'depth' | 'time',
    readonly limit: number,
  ) {
    super(
      kind === 'steps'
        ? `Evaluation exceeded its budget of ${limit} steps.`
        : kind === 'depth'
          ? `Recursion went deeper than ${limit} frames. Lower the bound, or rewrite the recurrence so it walks forward.`
          : `Evaluation exceeded its time budget of ${limit} ms.`,
    );
    this.name = 'BudgetExceeded';
  }
}
