/**
 * Worked examples, used to seed a new workspace and to exercise the engine in
 * tests. Every one of these is real mathematics with a real, checkable answer —
 * two claims with famous small counterexamples, one whose counterexample is far
 * out of reach, and one that holds throughout a finite space.
 *
 * The point of shipping these is that a first-run workspace should demonstrate
 * the honest outcomes, including the one where the search finds nothing and the
 * claim simply stays open.
 */

import type { SearchRequest } from './search.js';

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly prose: string;
  readonly lean: string;
  readonly request: SearchRequest;
  /** What this example is here to demonstrate. */
  readonly expect: 'witness' | 'exhausted' | 'budget';
  readonly note: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'euler_polynomial',
    title: 'Euler’s prime-generating polynomial',
    prose: 'For every natural number n, the value n² + n + 41 is prime.',
    lean: 'theorem euler_polynomial (n : ℕ) : Nat.Prime (n ^ 2 + n + 41) := by\n  sorry',
    expect: 'witness',
    note: 'Holds for n = 0 … 39 and fails at n = 40, where the value is 41². The classic demonstration that checking the first forty cases proves nothing.',
    request: {
      definitions: 'p(n) = n ^ 2 + n + 41',
      predicate: 'isPrime(p(n))',
      variables: [{ name: 'n', from: 0n, to: 1_000_000n }],
      strategy: 'enumerate',
      budgetMs: 20_000,
      maxCandidates: 1_000_000,
      report: [
        { label: 'n² + n + 41', expr: 'p(n)' },
        { label: 'least factor', expr: 'if isPrime(p(n)) then p(n) else isqrt(p(n))' },
      ],
    },
  },
  {
    id: 'mersenne_prime_exponent',
    title: 'Mersenne numbers at prime exponents',
    prose: 'If p is prime then 2^p − 1 is prime.',
    lean: 'theorem mersenne_of_prime (p : ℕ) (hp : Nat.Prime p) :\n    Nat.Prime (2 ^ p - 1) := by\n  sorry',
    expect: 'witness',
    note: 'True for p = 2, 3, 5, 7 and false at p = 11, where 2¹¹ − 1 = 2047 = 23 · 89.',
    request: {
      definitions: 'm(p) = 2 ^ p - 1',
      predicate: '!isPrime(p) || isPrime(m(p))',
      variables: [{ name: 'p', from: 2n, to: 4_000n }],
      strategy: 'enumerate',
      budgetMs: 20_000,
      maxCandidates: 4_000,
      report: [{ label: '2^p − 1', expr: 'm(p)' }],
    },
  },
  {
    id: 'polya',
    title: 'The Pólya conjecture',
    prose:
      'For every n greater than 1, at least half the natural numbers from 1 to n have an odd number of prime factors, counted with multiplicity.',
    lean:
      'theorem polya (n : ℕ) (hn : 1 < n) :\n    ∑ k ∈ Finset.Icc 1 n, liouville k ≤ 0 := by\n  sorry',
    expect: 'budget',
    note: 'The first counterexample is n = 906,150,257, far outside any range this bench will reach. Searching and finding nothing is the honest outcome here, and the interface reports it as "still open" rather than as evidence.',
    request: {
      definitions: [
        '-- leastFactor walks the trial divisors; the d parameter is the loop counter',
        'leastFactorFrom(n, d) when d * d > n = n',
        'leastFactorFrom(n, d) when n % d == 0 = d',
        'leastFactorFrom(n, d) = leastFactorFrom(n, d + 1)',
        'leastFactor(n) = leastFactorFrom(n, 2)',
        '-- omega(n): prime factors of n counted with multiplicity',
        'omega(n) when n <= 1 = 0',
        'omega(n) = 1 + omega(n / leastFactor(n))',
        '-- Liouville lambda, and L(n) its running sum',
        'lambda(n) = if omega(n) % 2 == 1 then 0 - 1 else 1',
        'L(0) = 0',
        'L(n) = L(n - 1) + lambda(n)',
      ].join('\n'),
      predicate: 'L(n) <= 0',
      // Deliberately far wider than the budget can cover, so this example ends
      // in "we stopped looking" rather than "we checked everything".
      variables: [{ name: 'n', from: 2n, to: 1_000_000n }],
      strategy: 'enumerate',
      budgetMs: 6_000,
      maxCandidates: 1_000_000,
      report: [
        { label: 'L(n)', expr: 'L(n)' },
        { label: 'Ω(n)', expr: 'omega(n)' },
      ],
    },
  },
  {
    id: 'collatz_bounded',
    title: 'Collatz reaches 1 below 100,000',
    prose:
      'Every natural number below 100,000 reaches 1 under the Collatz map within 1,000 steps.',
    lean:
      'theorem collatz_small (n : ℕ) (h : 0 < n) (h2 : n < 100000) :\n    ∃ k ≤ 1000, collatz^[k] n = 1 := by\n  sorry',
    expect: 'exhausted',
    note: 'The whole declared space really is checked, so the outcome is "exhausted" — still not a proof of anything beyond the bound, and the interface says so.',
    request: {
      definitions: [
        'steps(1) = 0',
        'steps(n) when n % 2 == 0 = 1 + steps(n / 2)',
        'steps(n) = 1 + steps(3 * n + 1)',
      ].join('\n'),
      predicate: 'steps(n) <= 1000',
      variables: [{ name: 'n', from: 1n, to: 100_000n }],
      strategy: 'enumerate',
      budgetMs: 30_000,
      maxCandidates: 100_000,
      report: [{ label: 'steps', expr: 'steps(n)' }],
    },
  },
];

export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((example) => example.id === id);
}
