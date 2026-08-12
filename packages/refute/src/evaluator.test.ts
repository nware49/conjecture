import { describe, expect, it } from 'vitest';
import { BudgetExceeded, EvalError } from './errors.js';
import { DEFAULT_BUDGET, Evaluator, type Value } from './evaluator.js';
import { parseExpression, parseProgram } from './parser.js';

function evaluate(
  source: string,
  expr: string,
  bindings: Record<string, Value> = {},
  budget = DEFAULT_BUDGET,
): Value {
  const evaluator = new Evaluator(parseProgram(source), budget);
  return evaluator.evaluate(parseExpression(expr), new Map(Object.entries(bindings)));
}

describe('arithmetic', () => {
  it('is exact well past the range of a double', () => {
    expect(evaluate('', '2 ^ 200')).toBe(2n ** 200n);
    expect(evaluate('', '9007199254740993 + 1')).toBe(9007199254740994n);
  });

  it('applies conventional precedence', () => {
    expect(evaluate('', '2 + 3 * 4')).toBe(14n);
    expect(evaluate('', '(2 + 3) * 4')).toBe(20n);
    expect(evaluate('', '2 ^ 3 ^ 2')).toBe(512n); // right associative
    expect(evaluate('', '-2 ^ 2')).toBe(-4n); // unary minus binds looser than ^
  });

  it('floors division and keeps the remainder non-negative', () => {
    expect(evaluate('', '(0 - 7) / 2')).toBe(-4n);
    expect(evaluate('', '(0 - 1) % 7')).toBe(6n);
  });

  it('refuses division by zero instead of returning infinity', () => {
    expect(() => evaluate('', '1 / 0')).toThrow(EvalError);
    expect(() => evaluate('', '1 % 0')).toThrow(EvalError);
  });

  it('rejects decimals at the lexer, with a reason', () => {
    expect(() => evaluate('', '1.5')).toThrow(/exact integers/);
  });
});

describe('booleans', () => {
  it('short-circuits, so a guarded division is safe', () => {
    expect(evaluate('', 'n > 0 && 10 / n > 2', { n: 0n })).toBe(false);
    expect(evaluate('', 'n == 0 || 10 / n > 2', { n: 0n })).toBe(true);
  });

  it('refuses to compare an integer with a boolean', () => {
    expect(() => evaluate('', '1 == true')).toThrow(EvalError);
  });

  it('rejects chained comparisons rather than guessing', () => {
    expect(() => evaluate('', '1 < 2 < 3')).toThrow(/Chained comparisons/);
  });
});

describe('definitions', () => {
  it('matches literal patterns before the general clause', () => {
    const fib = 'f(0) = 0\nf(1) = 1\nf(n) = f(n - 1) + f(n - 2)';
    expect(evaluate(fib, 'f(10)')).toBe(55n);
    expect(evaluate(fib, 'f(90)')).toBe(2880067194370816120n);
  });

  it('honours a when guard', () => {
    const source = 'g(n) when n % 2 == 0 = n / 2\ng(n) = 3 * n + 1';
    expect(evaluate(source, 'g(8)')).toBe(4n);
    expect(evaluate(source, 'g(7)')).toBe(22n);
  });

  it('supports multi-argument recurrences', () => {
    const binom = 'c(n, 0) = 1\nc(n, k) when k == n = 1\nc(n, k) = c(n - 1, k - 1) + c(n - 1, k)';
    expect(evaluate(binom, 'c(20, 10)')).toBe(184756n);
  });

  it('says which call had no matching clause', () => {
    expect(() => evaluate('h(0) = 1', 'h(5)')).toThrow(/No clause of h matches 5/);
  });

  it('rejects a call to a function nothing defines, before any search runs', () => {
    expect(() => evaluate('k(n) = missing(n)', 'k(1)')).toThrow(/Unknown function missing\/1/);
  });

  it('treats a nullary definition as a named constant', () => {
    expect(evaluate('bound = 2 ^ 10', 'bound + 1')).toBe(1025n);
  });

  it('binds let', () => {
    expect(evaluate('', 'let x = 6 in x * 7')).toBe(42n);
  });
});

describe('memoisation', () => {
  it('makes a forward-walking recurrence cheap across repeated calls', () => {
    const evaluator = new Evaluator(parseProgram('s(0) = 0\ns(n) = s(n - 1) + n'), DEFAULT_BUDGET);
    const expr = parseExpression('s(n)');
    // Walking n upward keeps the recursion one frame deep, because s(n-1) is
    // already cached. Without that, this would need 20,000 nested frames.
    let last = 0n;
    for (let n = 0; n <= 20_000; n += 1) {
      evaluator.beginCandidate();
      last = evaluator.evaluate(expr, new Map([['n', BigInt(n)]])) as bigint;
    }
    expect(last).toBe((20_000n * 20_001n) / 2n);
  });

  it('reports a depth budget failure rather than crashing on deep cold recursion', () => {
    const evaluator = new Evaluator(parseProgram('s(0) = 0\ns(n) = s(n - 1) + n'), {
      ...DEFAULT_BUDGET,
      maxDepth: 50,
    });
    expect(() => evaluator.evaluate(parseExpression('s(5000)'), new Map())).toThrow(BudgetExceeded);
  });
});

describe('budgets', () => {
  it('stops a runaway computation at the step limit', () => {
    const evaluator = new Evaluator(parseProgram('loop(n) = loop(n + 1)'), {
      ...DEFAULT_BUDGET,
      maxSteps: 5_000,
      maxDepth: 100_000,
    });
    expect(() => evaluator.evaluate(parseExpression('loop(0)'), new Map())).toThrow(BudgetExceeded);
  });

  it('refuses a power that would need an absurd number of bits', () => {
    expect(() => evaluate('', '2 ^ 99999999')).toThrow(/Exponent too large|bits/);
  });

  it('refuses negative exponents rather than leaving the integers', () => {
    expect(() => evaluate('', '2 ^ (0 - 1)')).toThrow(/Negative exponents/);
  });
});

describe('builtins', () => {
  it('exposes the number-theory helpers a claim usually needs', () => {
    expect(evaluate('', 'gcd(12, 18)')).toBe(6n);
    expect(evaluate('', 'isqrt(1681)')).toBe(41n);
    expect(evaluate('', 'isSquare(1681)')).toBe(true);
    expect(evaluate('', 'isPrime(1681)')).toBe(false);
    expect(evaluate('', 'numDivisors(28)')).toBe(6n);
    expect(evaluate('', 'popcount(255)')).toBe(8n);
    expect(evaluate('', 'max(min(3, 4), 2)')).toBe(3n);
  });

  it('records when a primality answer was probabilistic rather than decided', () => {
    const evaluator = new Evaluator(parseProgram(''), DEFAULT_BUDGET);
    evaluator.evaluate(parseExpression('isPrime(97)'), new Map());
    expect(evaluator.flags.usedProbabilisticPrimality).toBe(false);
    evaluator.evaluate(parseExpression('isPrime(2 ^ 521 - 1)'), new Map());
    expect(evaluator.flags.usedProbabilisticPrimality).toBe(true);
  });

  it('requires the predicate to be a claim, not a number', () => {
    const evaluator = new Evaluator(parseProgram(''), DEFAULT_BUDGET);
    expect(() => evaluator.evaluateBoolean(parseExpression('1 + 1'), new Map())).toThrow(
      /true\/false claim/,
    );
  });
});
