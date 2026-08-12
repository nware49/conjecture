/**
 * Exact integer arithmetic.
 *
 * Everything here is BigInt. No floating point touches a candidate at any
 * point, because a counterexample that turns out to be a rounding artefact is
 * worse than no counterexample at all.
 */

/** Bases that make Miller-Rabin deterministic below DETERMINISTIC_BOUND. */
const MILLER_RABIN_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n] as const;

/**
 * Below this, the twelve bases above decide primality exactly. Above it, the
 * same test is a very strong probable-prime check and the caller is told so.
 */
export const DETERMINISTIC_BOUND = 3317044064679887385961981n;

export function abs(a: bigint): bigint {
  return a < 0n ? -a : a;
}

export function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

export function lcm(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return abs(a / gcd(a, b)) * abs(b);
}

/** Floor division, which is what `mod` in number theory expects. */
export function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return (a % b !== 0n && a < 0n !== b < 0n) ? q - 1n : q;
}

/** Euclidean remainder: always in [0, |b|). */
export function euclideanMod(a: bigint, b: bigint): bigint {
  const r = a % b;
  return r < 0n ? r + abs(b) : r;
}

/** Integer square root by Newton's method. Exact for every non-negative input. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt of a negative number');
  if (n < 2n) return n;

  // Start from a power of two above the true root so the iteration descends.
  let x = 1n << BigInt(Math.ceil(bitLength(n) / 2));
  for (;;) {
    const next = (x + n / x) >> 1n;
    if (next >= x) break;
    x = next;
  }
  return x;
}

export function isSquare(n: bigint): boolean {
  if (n < 0n) return false;
  const r = isqrt(n);
  return r * r === n;
}

export function bitLength(n: bigint): number {
  const v = abs(n);
  if (v === 0n) return 0;
  return v.toString(2).length;
}

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n;
  let result = 1n;
  let b = euclideanMod(base, modulus);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

export interface PrimalityResult {
  readonly prime: boolean;
  /**
   * True when the input was above the deterministic bound, so the answer is a
   * probable-prime verdict rather than a decision. The search records this and
   * the interface says it out loud.
   */
  readonly probabilistic: boolean;
}

export function isPrimeDetailed(n: bigint): PrimalityResult {
  const probabilistic = n >= DETERMINISTIC_BOUND;
  if (n < 2n) return { prime: false, probabilistic: false };
  for (const p of MILLER_RABIN_BASES) {
    if (n === p) return { prime: true, probabilistic: false };
    if (n % p === 0n) return { prime: false, probabilistic: false };
  }

  let d = n - 1n;
  let r = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    r += 1;
  }

  witness: for (const a of MILLER_RABIN_BASES) {
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    for (let i = 1; i < r; i += 1) {
      x = (x * x) % n;
      if (x === n - 1n) continue witness;
    }
    return { prime: false, probabilistic: false };
  }
  return { prime: true, probabilistic };
}

export function isPrime(n: bigint): boolean {
  return isPrimeDetailed(n).prime;
}

/**
 * Trial division up to the square root. `cost` is reported so the evaluator can
 * charge it against the step budget — an unbounded factorisation inside a
 * search loop is the easiest way to make a tool feel broken.
 */
export function factorize(n: bigint): { factors: Map<bigint, number>; cost: number } {
  const factors = new Map<bigint, number>();
  let remaining = abs(n);
  let cost = 0;

  if (remaining <= 1n) return { factors, cost };

  for (let p = 2n; p * p <= remaining; p += p === 2n ? 1n : 2n) {
    cost += 1;
    let power = 0;
    while (remaining % p === 0n) {
      remaining /= p;
      power += 1;
    }
    if (power > 0) factors.set(p, power);
  }
  if (remaining > 1n) factors.set(remaining, (factors.get(remaining) ?? 0) + 1);
  return { factors, cost };
}

export function numDivisors(n: bigint): { value: bigint; cost: number } {
  if (n === 0n) return { value: 0n, cost: 0 };
  const { factors, cost } = factorize(n);
  let total = 1n;
  for (const power of factors.values()) total *= BigInt(power + 1);
  return { value: total, cost };
}

export function sumDivisors(n: bigint): { value: bigint; cost: number } {
  if (n === 0n) return { value: 0n, cost: 0 };
  const { factors, cost } = factorize(n);
  let total = 1n;
  for (const [prime, power] of factors) {
    let term = 1n;
    let p = 1n;
    for (let i = 0; i < power; i += 1) {
      p *= prime;
      term += p;
    }
    total *= term;
  }
  return { value: total, cost };
}

export function popcount(n: bigint): bigint {
  let v = abs(n);
  let count = 0n;
  while (v > 0n) {
    if (v & 1n) count += 1n;
    v >>= 1n;
  }
  return count;
}

export function digitSum(n: bigint, base = 10n): bigint {
  if (base < 2n) throw new RangeError('digitSum base must be at least 2');
  let v = abs(n);
  let total = 0n;
  while (v > 0n) {
    total += v % base;
    v /= base;
  }
  return total;
}
