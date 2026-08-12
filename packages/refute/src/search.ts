/**
 * The counterexample bench.
 *
 * Search runs over a declared parameter space and reports the smallest witness
 * it finds. Two rules make the result worth showing:
 *
 *   1. Every candidate is evaluated in exact integer arithmetic.
 *   2. A witness is re-evaluated by a second, cold evaluator before it is
 *      reported, so a memoisation bug cannot manufacture a counterexample.
 *
 * "No counterexample found" is reported as three different outcomes, because
 * "we checked the whole space", "we ran out of time" and "we ran out of
 * candidates" are three different claims about the world.
 */

import type { Expr, Program } from './ast.js';
import { BudgetExceeded, SourceError, type Position } from './errors.js';
import { DEFAULT_BUDGET, Evaluator, type Budget, type Value } from './evaluator.js';
import { parseExpression, parseProgram } from './parser.js';

export interface VariableSpace {
  readonly name: string;
  readonly from: bigint;
  /** Inclusive upper bound. */
  readonly to: bigint;
  /** Defaults to 1. Must be positive. */
  readonly step?: bigint;
}

export type SearchStrategy =
  /** Ascending, first variable slowest. The first hit is the smallest witness. */
  | 'enumerate'
  /** Uniform sampling. Finds distant witnesses that enumeration would not reach. */
  | 'random';

export interface ReportColumn {
  readonly label: string;
  readonly expr: string;
}

export interface SearchRequest {
  /** Definitions in the recurrence language. May be empty. */
  readonly definitions: string;
  /** The claim under test. A candidate making this false is a counterexample. */
  readonly predicate: string;
  readonly variables: readonly VariableSpace[];
  readonly strategy: SearchStrategy;
  readonly budgetMs: number;
  readonly maxCandidates: number;
  /** Extra expressions recorded per candidate for the trace table. */
  readonly report?: readonly ReportColumn[];
  readonly seed?: number;
  /** How many recent candidates to keep for display. Defaults to 16. */
  readonly traceSize?: number;
}

export interface TraceRow {
  readonly assignment: Readonly<Record<string, string>>;
  readonly values: Readonly<Record<string, string>>;
  readonly holds: boolean;
}

export interface SearchProgress {
  readonly candidatesChecked: number;
  readonly elapsedMs: number;
  /** Fraction of the declared space covered, when the space is finite and small. */
  readonly fraction: number | null;
}

export interface Witness {
  readonly assignment: Readonly<Record<string, string>>;
  readonly evaluation: string;
}

interface OutcomeBase {
  readonly candidatesChecked: number;
  readonly elapsedMs: number;
  readonly trace: readonly TraceRow[];
  /** True when a primality test above the deterministic bound was involved. */
  readonly usedProbabilisticPrimality: boolean;
}

export type SearchOutcome =
  | (OutcomeBase & { readonly kind: 'witness'; readonly witness: Witness })
  /** The entire declared space was checked and the claim held throughout. */
  | (OutcomeBase & { readonly kind: 'exhausted' })
  /** Stopped early. The claim stays open; it was not shown to hold. */
  | (OutcomeBase & { readonly kind: 'budget'; readonly reason: 'time' | 'candidates' })
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly position: Position | null;
      readonly candidatesChecked: number;
      readonly elapsedMs: number;
    };

export interface RunOptions {
  readonly onProgress?: (progress: SearchProgress) => void;
  readonly signal?: AbortSignal;
  /** Injected for tests. Defaults to Date.now. */
  readonly now?: () => number;
  /** Yield to the event loop this often, in candidates. */
  readonly yieldEvery?: number;
}

const DEFAULT_TRACE_SIZE = 16;
const DEFAULT_YIELD_EVERY = 4096;
const PROGRESS_INTERVAL_MS = 120;

function countOf(space: VariableSpace): bigint {
  const step = space.step ?? 1n;
  if (step <= 0n) throw new RangeError(`Step for ${space.name} must be positive.`);
  if (space.to < space.from) return 0n;
  return (space.to - space.from) / step + 1n;
}

/** Total size of the declared space, or null when it overflows what we display. */
export function spaceSize(variables: readonly VariableSpace[]): bigint {
  return variables.reduce((total, v) => total * countOf(v), 1n);
}

class Odometer {
  private readonly counts: bigint[];
  private readonly digits: bigint[];
  private done: boolean;

  constructor(private readonly variables: readonly VariableSpace[]) {
    this.counts = variables.map(countOf);
    this.digits = variables.map(() => 0n);
    this.done = this.counts.some((c) => c === 0n);
  }

  get exhausted(): boolean {
    return this.done;
  }

  /** Current assignment, or null when the space is spent. */
  current(into: Map<string, Value>): boolean {
    if (this.done) return false;
    for (let i = 0; i < this.variables.length; i += 1) {
      const v = this.variables[i]!;
      into.set(v.name, v.from + this.digits[i]! * (v.step ?? 1n));
    }
    return true;
  }

  /** Advance with the last variable moving fastest. */
  advance(): void {
    for (let i = this.variables.length - 1; i >= 0; i -= 1) {
      this.digits[i] = this.digits[i]! + 1n;
      if (this.digits[i]! < this.counts[i]!) return;
      this.digits[i] = 0n;
    }
    this.done = true;
  }
}

/**
 * mulberry32 — a 32-bit generator with a full 2^32 period and well-behaved
 * distribution. Seeded, so a random search reproduces exactly; a counterexample
 * nobody can reproduce is not much of a counterexample.
 */
class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  }

  /** Uniform-ish in [0, bound). Good enough for sampling a search space. */
  belowBigInt(bound: bigint): bigint {
    if (bound <= 0n) return 0n;
    if (bound <= 0x100000000n) return BigInt(Math.floor(this.next() * Number(bound)));
    let result = 0n;
    let limit = bound;
    while (limit > 0n) {
      result = (result << 32n) | BigInt(Math.floor(this.next() * 0x100000000));
      limit >>= 32n;
    }
    return result % bound;
  }
}

function formatAssignment(bindings: ReadonlyMap<string, Value>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of bindings) out[key] = String(value);
  return out;
}

interface Compiled {
  readonly program: Program;
  readonly predicate: Expr;
  readonly report: readonly { label: string; expr: Expr }[];
}

function compile(request: SearchRequest): Compiled {
  const program = parseProgram(request.definitions);
  const predicate = parseExpression(request.predicate);
  const report = (request.report ?? []).map((column) => ({
    label: column.label,
    expr: parseExpression(column.expr),
  }));
  return { program, predicate, report };
}

/**
 * Re-check a witness with a brand-new evaluator and an empty memo cache.
 *
 * This is the honesty check. The search is allowed to be fast and clever; the
 * thing it reports is re-derived from scratch before anyone sees it.
 */
export function verifyWitness(
  request: SearchRequest,
  assignment: Readonly<Record<string, string>>,
): { holds: boolean; error: string | null } {
  try {
    const { program, predicate } = compile(request);
    const evaluator = new Evaluator(program, DEFAULT_BUDGET);
    const bindings = new Map<string, Value>(
      Object.entries(assignment).map(([k, v]) => [k, BigInt(v)]),
    );
    return { holds: evaluator.evaluateBoolean(predicate, bindings), error: null };
  } catch (error) {
    return { holds: true, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runSearch(
  request: SearchRequest,
  options: RunOptions = {},
): Promise<SearchOutcome> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const yieldEvery = options.yieldEvery ?? DEFAULT_YIELD_EVERY;
  const traceSize = request.traceSize ?? DEFAULT_TRACE_SIZE;

  let checked = 0;
  const trace: TraceRow[] = [];
  const pushTrace = (row: TraceRow): void => {
    trace.push(row);
    if (trace.length > traceSize) trace.shift();
  };

  let compiled: Compiled;
  try {
    compiled = compile(request);
  } catch (error) {
    return compileFailure(error, checked, now() - startedAt);
  }

  let evaluator: Evaluator;
  const deadline = startedAt + request.budgetMs;
  const budget: Budget = { ...DEFAULT_BUDGET, deadline };
  try {
    evaluator = new Evaluator(compiled.program, budget);
  } catch (error) {
    return compileFailure(error, checked, now() - startedAt);
  }

  const total = spaceSize(request.variables);
  const totalNumber = total <= 9007199254740991n ? Number(total) : null;
  const rng = new Rng(request.seed ?? 0x5eed);
  const odometer = new Odometer(request.variables);
  const bindings = new Map<string, Value>();
  let lastProgressAt = startedAt;

  const finish = (
    kind: 'exhausted' | 'budget',
    reason?: 'time' | 'candidates',
  ): SearchOutcome => {
    const base = {
      candidatesChecked: checked,
      elapsedMs: now() - startedAt,
      trace: [...trace],
      usedProbabilisticPrimality: evaluator.flags.usedProbabilisticPrimality,
    };
    return kind === 'exhausted'
      ? { kind: 'exhausted', ...base }
      : { kind: 'budget', reason: reason ?? 'candidates', ...base };
  };

  for (;;) {
    if (options.signal?.aborted) return finish('budget', 'time');
    if (checked >= request.maxCandidates) return finish('budget', 'candidates');

    if (request.strategy === 'enumerate') {
      if (!odometer.current(bindings)) return finish('exhausted');
    } else {
      bindings.clear();
      for (const v of request.variables) {
        const step = v.step ?? 1n;
        bindings.set(v.name, v.from + rng.belowBigInt(countOf(v)) * step);
      }
    }

    let holds: boolean;
    try {
      evaluator.beginCandidate(budget);
      holds = evaluator.evaluateBoolean(compiled.predicate, bindings);
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        return error.kind === 'time' ? finish('budget', 'time') : finish('budget', 'candidates');
      }
      return compileFailure(error, checked, now() - startedAt);
    }

    checked += 1;

    const values: Record<string, string> = {};
    if (compiled.report.length > 0 && (!holds || trace.length < traceSize || true)) {
      for (const column of compiled.report) {
        try {
          values[column.label] = String(evaluator.evaluate(column.expr, bindings));
        } catch {
          // A report column is decoration. It must never sink a search.
          values[column.label] = '—';
        }
      }
    }
    pushTrace({ assignment: formatAssignment(bindings), values, holds });

    if (!holds) {
      const assignment = formatAssignment(bindings);
      const recheck = verifyWitness(request, assignment);
      if (recheck.holds) {
        // The cold re-evaluation disagreed. Report nothing rather than a
        // counterexample we cannot stand behind.
        return {
          kind: 'error',
          message:
            recheck.error ??
            'A candidate failed during search but held on independent re-evaluation. Refusing to report it.',
          position: null,
          candidatesChecked: checked,
          elapsedMs: now() - startedAt,
        };
      }
      return {
        kind: 'witness',
        witness: { assignment, evaluation: describeWitness(assignment, values) },
        candidatesChecked: checked,
        elapsedMs: now() - startedAt,
        trace: [...trace],
        usedProbabilisticPrimality: evaluator.flags.usedProbabilisticPrimality,
      };
    }

    if (request.strategy === 'enumerate') {
      odometer.advance();
      if (odometer.exhausted) return finish('exhausted');
    }

    const elapsed = now() - startedAt;
    if (elapsed >= request.budgetMs) return finish('budget', 'time');

    if (options.onProgress && now() - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = now();
      options.onProgress({
        candidatesChecked: checked,
        elapsedMs: elapsed,
        fraction: totalNumber === null ? null : Math.min(1, checked / totalNumber),
      });
    }

    if (checked % yieldEvery === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

function describeWitness(
  assignment: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
): string {
  const parts = Object.entries(assignment).map(([k, v]) => `${k} = ${v}`);
  for (const [label, value] of Object.entries(values)) parts.push(`${label} = ${value}`);
  return parts.join(' · ');
}

function compileFailure(
  error: unknown,
  candidatesChecked: number,
  elapsedMs: number,
): SearchOutcome {
  if (error instanceof SourceError) {
    return {
      kind: 'error',
      message: error.message,
      position: error.position,
      candidatesChecked,
      elapsedMs,
    };
  }
  return {
    kind: 'error',
    message: error instanceof Error ? error.message : String(error),
    position: null,
    candidatesChecked,
    elapsedMs,
  };
}

/** The house-voice sentence for an outcome. Says what happened, nothing more. */
export function describeOutcome(outcome: SearchOutcome, upperBound?: string): string {
  switch (outcome.kind) {
    case 'witness':
      return `Counterexample found after ${outcome.candidatesChecked.toLocaleString()} candidates: ${outcome.witness.evaluation}.`;
    case 'exhausted':
      return `No counterexample in the declared space — ${outcome.candidatesChecked.toLocaleString()} candidates, all of it. The claim is not proved by this; it is only unrefuted here.`;
    case 'budget':
      return outcome.reason === 'time'
        ? `No counterexample${upperBound ? ` under ${upperBound}` : ''} within the ${(outcome.elapsedMs / 1000).toFixed(0)}s budget. The claim stays open. Widen the bounds or split it into cases.`
        : `No counterexample in ${outcome.candidatesChecked.toLocaleString()} candidates. The claim stays open. Raise the candidate limit or widen the bounds.`;
    case 'error':
      return outcome.position
        ? `${outcome.position.line}:${outcome.position.column} ${outcome.message}`
        : outcome.message;
  }
}
