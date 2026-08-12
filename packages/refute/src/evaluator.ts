/**
 * The evaluator.
 *
 * User definitions are memoised, which is not only a speed trick: it is what
 * lets a recurrence written the natural way — f(n) = f(n-1) + … — survive a
 * search over a million candidates. Enumerating n upward means f(n-1) is
 * already in the cache when f(n) is asked for, so recursion depth stays at one
 * frame instead of a million.
 */

import type { Clause, Expr, Program } from './ast.js';
import { clauseKey, groupClauses } from './ast.js';
import * as arith from './arith.js';
import { BudgetExceeded, EvalError, type Position } from './errors.js';

export type Value = bigint | boolean;

export interface Budget {
  /** Evaluation steps across the whole call. */
  readonly maxSteps: number;
  /** Nested user-function frames. */
  readonly maxDepth: number;
  /** Wall-clock deadline as an epoch millisecond value, or null for none. */
  readonly deadline: number | null;
}

export const DEFAULT_BUDGET: Budget = {
  maxSteps: 5_000_000,
  maxDepth: 2_000,
  deadline: null,
};

/** Ceiling on the size of any intermediate integer, in bits. */
const MAX_BITS = 1 << 20;

/** How many memo entries to hold before evicting the oldest half. */
const MEMO_CAPACITY = 1_000_000;

const CHECK_DEADLINE_EVERY = 8192;

export interface EvaluationFlags {
  /** A primality test ran above the deterministic bound. */
  usedProbabilisticPrimality: boolean;
}

interface Scope {
  readonly vars: ReadonlyMap<string, Value>;
  readonly parent: Scope | null;
}

function lookup(scope: Scope | null, name: string): Value | undefined {
  for (let s = scope; s !== null; s = s.parent) {
    const found = s.vars.get(name);
    if (found !== undefined) return found;
  }
  return undefined;
}

type Builtin = (args: readonly Value[], pos: Position, ctx: Evaluator) => Value;

export class Evaluator {
  private readonly clauses: ReadonlyMap<string, readonly Clause[]>;
  private readonly memo = new Map<string, Value>();
  private steps = 0;
  private depth = 0;
  readonly flags: EvaluationFlags = { usedProbabilisticPrimality: false };

  constructor(
    program: Program,
    private budget: Budget = DEFAULT_BUDGET,
  ) {
    this.clauses = groupClauses(program);
    this.checkDefinitions();
  }

  /** Reset counters between candidates while keeping the memo cache warm. */
  beginCandidate(budget?: Budget): void {
    this.steps = 0;
    this.depth = 0;
    if (budget) this.budget = budget;
  }

  get stepsUsed(): number {
    return this.steps;
  }

  get memoSize(): number {
    return this.memo.size;
  }

  /** Reject definitions that refer to names nothing provides, before searching. */
  private checkDefinitions(): void {
    for (const group of this.clauses.values()) {
      for (const clause of group) {
        const bound = new Set(
          clause.params.flatMap((p) => (p.kind === 'binding' ? [p.name] : [])),
        );
        this.checkNames(clause.body, bound);
        if (clause.guard) this.checkNames(clause.guard, bound);
      }
    }
  }

  private checkNames(expr: Expr, bound: ReadonlySet<string>): void {
    switch (expr.kind) {
      case 'num':
      case 'bool':
        return;
      case 'var':
        // Free variables are legal: the search binds them per candidate.
        return;
      case 'call': {
        const key = clauseKey(expr.callee, expr.args.length);
        if (!this.clauses.has(key) && !(expr.callee in BUILTINS)) {
          throw new EvalError(
            `Unknown function ${expr.callee}/${expr.args.length}.`,
            expr.pos,
          );
        }
        for (const arg of expr.args) this.checkNames(arg, bound);
        return;
      }
      case 'unary':
        this.checkNames(expr.operand, bound);
        return;
      case 'binary':
        this.checkNames(expr.left, bound);
        this.checkNames(expr.right, bound);
        return;
      case 'if':
        this.checkNames(expr.cond, bound);
        this.checkNames(expr.then, bound);
        this.checkNames(expr.otherwise, bound);
        return;
      case 'let':
        this.checkNames(expr.value, bound);
        this.checkNames(expr.body, new Set([...bound, expr.name]));
        return;
    }
  }

  evaluate(expr: Expr, bindings: ReadonlyMap<string, Value>): Value {
    try {
      return this.evalExpr(expr, { vars: bindings, parent: null });
    } catch (error) {
      // A deep non-memoisable recursion can reach the host stack limit before
      // our own depth counter does. Report it as the budget problem it is.
      if (error instanceof RangeError && /call stack/i.test(error.message)) {
        throw new BudgetExceeded('depth', this.budget.maxDepth);
      }
      throw error;
    }
  }

  evaluateInteger(expr: Expr, bindings: ReadonlyMap<string, Value>): bigint {
    const value = this.evaluate(expr, bindings);
    if (typeof value !== 'bigint') {
      throw new EvalError('Expected an integer, got a boolean.', expr.pos);
    }
    return value;
  }

  evaluateBoolean(expr: Expr, bindings: ReadonlyMap<string, Value>): boolean {
    const value = this.evaluate(expr, bindings);
    if (typeof value !== 'boolean') {
      throw new EvalError(
        'Expected a true/false claim. Write a comparison, for example f(n) <= 2 * n.',
        expr.pos,
      );
    }
    return value;
  }

  private tick(pos: Position): void {
    this.steps += 1;
    if (this.steps > this.budget.maxSteps) {
      throw new BudgetExceeded('steps', this.budget.maxSteps);
    }
    if (this.budget.deadline !== null && this.steps % CHECK_DEADLINE_EVERY === 0) {
      if (Date.now() > this.budget.deadline) throw new BudgetExceeded('time', 0);
    }
    void pos;
  }

  private charge(units: number): void {
    this.steps += units;
    if (this.steps > this.budget.maxSteps) {
      throw new BudgetExceeded('steps', this.budget.maxSteps);
    }
  }

  private evalExpr(expr: Expr, scope: Scope): Value {
    this.tick(expr.pos);

    switch (expr.kind) {
      case 'num':
        return expr.value;
      case 'bool':
        return expr.value;

      case 'var': {
        const found = lookup(scope, expr.name);
        if (found === undefined) {
          // A nullary definition reads like a variable at the use site.
          const nullary = this.clauses.get(clauseKey(expr.name, 0));
          if (nullary) return this.callUser(expr.name, [], expr.pos);
          throw new EvalError(`${expr.name} is not defined.`, expr.pos);
        }
        return found;
      }

      case 'let': {
        const value = this.evalExpr(expr.value, scope);
        return this.evalExpr(expr.body, {
          vars: new Map([[expr.name, value]]),
          parent: scope,
        });
      }

      case 'if': {
        const cond = this.evalExpr(expr.cond, scope);
        if (typeof cond !== 'boolean') {
          throw new EvalError('The condition of an if must be true or false.', expr.cond.pos);
        }
        return this.evalExpr(cond ? expr.then : expr.otherwise, scope);
      }

      case 'unary': {
        const operand = this.evalExpr(expr.operand, scope);
        if (expr.op === '-') {
          if (typeof operand !== 'bigint') {
            throw new EvalError('Cannot negate a boolean.', expr.pos);
          }
          return -operand;
        }
        if (typeof operand !== 'boolean') {
          throw new EvalError('Cannot apply ! to an integer.', expr.pos);
        }
        return !operand;
      }

      case 'binary':
        return this.evalBinary(expr, scope);

      case 'call': {
        const key = clauseKey(expr.callee, expr.args.length);
        if (this.clauses.has(key)) {
          const args = expr.args.map((arg) => this.evalExpr(arg, scope));
          return this.callUser(expr.callee, args, expr.pos);
        }
        const builtin = BUILTINS[expr.callee];
        if (!builtin) {
          throw new EvalError(`Unknown function ${expr.callee}/${expr.args.length}.`, expr.pos);
        }
        const args = expr.args.map((arg) => this.evalExpr(arg, scope));
        return builtin(args, expr.pos, this);
      }
    }
  }

  private evalBinary(
    expr: Extract<Expr, { kind: 'binary' }>,
    scope: Scope,
  ): Value {
    // Short-circuit before evaluating the right operand, so `n > 0 && 10 / n > 2`
    // does what it looks like it does.
    if (expr.op === '&&' || expr.op === '||') {
      const left = this.evalExpr(expr.left, scope);
      if (typeof left !== 'boolean') {
        throw new EvalError(`${expr.op} needs true/false operands.`, expr.left.pos);
      }
      if (expr.op === '&&' && !left) return false;
      if (expr.op === '||' && left) return true;
      const right = this.evalExpr(expr.right, scope);
      if (typeof right !== 'boolean') {
        throw new EvalError(`${expr.op} needs true/false operands.`, expr.right.pos);
      }
      return right;
    }

    const left = this.evalExpr(expr.left, scope);
    const right = this.evalExpr(expr.right, scope);

    if (expr.op === '==' || expr.op === '!=') {
      if (typeof left !== typeof right) {
        throw new EvalError('Cannot compare an integer with a boolean.', expr.pos);
      }
      return expr.op === '==' ? left === right : left !== right;
    }

    if (typeof left !== 'bigint' || typeof right !== 'bigint') {
      throw new EvalError(`${expr.op} needs integer operands.`, expr.pos);
    }

    switch (expr.op) {
      case '+':
        return this.sized(left + right, expr.pos);
      case '-':
        return this.sized(left - right, expr.pos);
      case '*':
        this.charge(Math.ceil((arith.bitLength(left) + arith.bitLength(right)) / 64));
        return this.sized(left * right, expr.pos);
      case '/':
        if (right === 0n) throw new EvalError('Division by zero.', expr.pos);
        return arith.floorDiv(left, right);
      case '%':
        if (right === 0n) throw new EvalError('Division by zero in %.', expr.pos);
        return arith.euclideanMod(left, right);
      case '^':
        return this.power(left, right, expr.pos);
      case '<':
        return left < right;
      case '<=':
        return left <= right;
      case '>':
        return left > right;
      case '>=':
        return left >= right;
      default:
        throw new EvalError(`Unsupported operator ${expr.op}.`, expr.pos);
    }
  }

  private power(base: bigint, exponent: bigint, pos: Position): bigint {
    if (exponent < 0n) {
      throw new EvalError(
        'Negative exponents would leave the integers. Use a rearranged inequality instead.',
        pos,
      );
    }
    if (exponent > BigInt(MAX_BITS)) {
      throw new EvalError(`Exponent too large: the result would exceed ${MAX_BITS} bits.`, pos);
    }
    const resultBits = arith.bitLength(base) * Number(exponent);
    if (resultBits > MAX_BITS) {
      throw new EvalError(
        `That power would need about ${resultBits} bits. The ceiling is ${MAX_BITS}.`,
        pos,
      );
    }
    this.charge(Math.ceil(resultBits / 64) + 1);
    return base ** exponent;
  }

  private sized(value: bigint, pos: Position): bigint {
    if (arith.bitLength(value) > MAX_BITS) {
      throw new EvalError(`Intermediate value exceeded ${MAX_BITS} bits.`, pos);
    }
    return value;
  }

  private callUser(name: string, args: readonly Value[], pos: Position): Value {
    const key = clauseKey(name, args.length);
    const clauses = this.clauses.get(key);
    if (!clauses) throw new EvalError(`Unknown function ${key}.`, pos);

    const memoKey = args.every((a) => typeof a === 'bigint')
      ? `${key}:${args.join(',')}`
      : null;
    if (memoKey !== null) {
      const cached = this.memo.get(memoKey);
      if (cached !== undefined) return cached;
    }

    this.depth += 1;
    if (this.depth > this.budget.maxDepth) {
      this.depth -= 1;
      throw new BudgetExceeded('depth', this.budget.maxDepth);
    }

    try {
      for (const clause of clauses) {
        const bindings = matchClause(clause, args);
        if (bindings === null) continue;
        const scope: Scope = { vars: bindings, parent: null };
        if (clause.guard !== null) {
          const guard = this.evalExpr(clause.guard, scope);
          if (typeof guard !== 'boolean') {
            throw new EvalError('A `when` guard must be true or false.', clause.guard.pos);
          }
          if (!guard) continue;
        }
        const result = this.evalExpr(clause.body, scope);
        if (memoKey !== null) this.remember(memoKey, result);
        return result;
      }
      throw new EvalError(
        `No clause of ${name} matches ${args.join(', ')}. Add a fallback case.`,
        pos,
      );
    } finally {
      this.depth -= 1;
    }
  }

  private remember(key: string, value: Value): void {
    if (this.memo.size >= MEMO_CAPACITY) {
      // Recurrences walk forward, so the oldest entries are the ones least
      // likely to be asked for again.
      let toDrop = Math.floor(MEMO_CAPACITY / 2);
      for (const k of this.memo.keys()) {
        this.memo.delete(k);
        toDrop -= 1;
        if (toDrop <= 0) break;
      }
    }
    this.memo.set(key, value);
  }

  noteProbabilisticPrimality(): void {
    this.flags.usedProbabilisticPrimality = true;
  }

  chargeExternal(units: number): void {
    this.charge(units);
  }
}

function matchClause(clause: Clause, args: readonly Value[]): Map<string, Value> | null {
  const bindings = new Map<string, Value>();
  for (let i = 0; i < clause.params.length; i += 1) {
    const param = clause.params[i]!;
    const arg = args[i]!;
    if (param.kind === 'literal') {
      if (typeof arg !== 'bigint' || arg !== param.value) return null;
    } else {
      bindings.set(param.name, arg);
    }
  }
  return bindings;
}

function intArg(args: readonly Value[], i: number, name: string, pos: Position): bigint {
  const value = args[i];
  if (typeof value !== 'bigint') {
    throw new EvalError(`${name} expects integer arguments.`, pos);
  }
  return value;
}

export const BUILTINS: Readonly<Record<string, Builtin>> = {
  abs: (args, pos) => arith.abs(intArg(args, 0, 'abs', pos)),
  sign: (args, pos) => {
    const n = intArg(args, 0, 'sign', pos);
    return n === 0n ? 0n : n < 0n ? -1n : 1n;
  },
  min: (args, pos) => {
    const a = intArg(args, 0, 'min', pos);
    const b = intArg(args, 1, 'min', pos);
    return a < b ? a : b;
  },
  max: (args, pos) => {
    const a = intArg(args, 0, 'max', pos);
    const b = intArg(args, 1, 'max', pos);
    return a > b ? a : b;
  },
  gcd: (args, pos) => arith.gcd(intArg(args, 0, 'gcd', pos), intArg(args, 1, 'gcd', pos)),
  lcm: (args, pos) => arith.lcm(intArg(args, 0, 'lcm', pos), intArg(args, 1, 'lcm', pos)),
  isqrt: (args, pos) => {
    const n = intArg(args, 0, 'isqrt', pos);
    if (n < 0n) throw new EvalError('isqrt of a negative number.', pos);
    return arith.isqrt(n);
  },
  isSquare: (args, pos) => arith.isSquare(intArg(args, 0, 'isSquare', pos)),
  isPrime: (args, pos, ctx) => {
    const n = intArg(args, 0, 'isPrime', pos);
    ctx.chargeExternal(Math.max(1, arith.bitLength(n)));
    const result = arith.isPrimeDetailed(n);
    if (result.probabilistic) ctx.noteProbabilisticPrimality();
    return result.prime;
  },
  numDivisors: (args, pos, ctx) => {
    const { value, cost } = arith.numDivisors(intArg(args, 0, 'numDivisors', pos));
    ctx.chargeExternal(cost);
    return value;
  },
  sumDivisors: (args, pos, ctx) => {
    const { value, cost } = arith.sumDivisors(intArg(args, 0, 'sumDivisors', pos));
    ctx.chargeExternal(cost);
    return value;
  },
  popcount: (args, pos) => arith.popcount(intArg(args, 0, 'popcount', pos)),
  digitSum: (args, pos) =>
    args.length > 1
      ? arith.digitSum(intArg(args, 0, 'digitSum', pos), intArg(args, 1, 'digitSum', pos))
      : arith.digitSum(intArg(args, 0, 'digitSum', pos)),
};

export const BUILTIN_NAMES = Object.keys(BUILTINS);
