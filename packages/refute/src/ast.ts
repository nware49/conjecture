import type { Position } from './errors.js';

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||';

export type UnaryOp = '-' | '!';

export type Expr =
  | { readonly kind: 'num'; readonly value: bigint; readonly pos: Position }
  | { readonly kind: 'bool'; readonly value: boolean; readonly pos: Position }
  | { readonly kind: 'var'; readonly name: string; readonly pos: Position }
  | {
      readonly kind: 'call';
      readonly callee: string;
      readonly args: readonly Expr[];
      readonly pos: Position;
    }
  | { readonly kind: 'unary'; readonly op: UnaryOp; readonly operand: Expr; readonly pos: Position }
  | {
      readonly kind: 'binary';
      readonly op: BinaryOp;
      readonly left: Expr;
      readonly right: Expr;
      readonly pos: Position;
    }
  | {
      readonly kind: 'if';
      readonly cond: Expr;
      readonly then: Expr;
      readonly otherwise: Expr;
      readonly pos: Position;
    }
  | {
      readonly kind: 'let';
      readonly name: string;
      readonly value: Expr;
      readonly body: Expr;
      readonly pos: Position;
    };

/**
 * A parameter is either a binding name or a literal to match. Literal patterns
 * let a recurrence be written the way it is written on paper:
 *
 *     f(0) = 0
 *     f(n) = f(n - 1) + 2
 */
export type Pattern =
  | { readonly kind: 'binding'; readonly name: string; readonly pos: Position }
  | { readonly kind: 'literal'; readonly value: bigint; readonly pos: Position };

export interface Clause {
  readonly name: string;
  readonly params: readonly Pattern[];
  /** An optional `when` guard, tried after the patterns match. */
  readonly guard: Expr | null;
  readonly body: Expr;
  readonly pos: Position;
}

export interface Program {
  readonly clauses: readonly Clause[];
}

export function arityOf(clause: Clause): number {
  return clause.params.length;
}

/** Group clauses by name and arity, preserving source order within a group. */
export function groupClauses(program: Program): ReadonlyMap<string, readonly Clause[]> {
  const groups = new Map<string, Clause[]>();
  for (const clause of program.clauses) {
    const key = `${clause.name}/${arityOf(clause)}`;
    const list = groups.get(key) ?? [];
    list.push(clause);
    groups.set(key, list);
  }
  return groups;
}

export function clauseKey(name: string, arity: number): string {
  return `${name}/${arity}`;
}
