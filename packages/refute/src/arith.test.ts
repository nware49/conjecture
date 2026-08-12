import { describe, expect, it } from 'vitest';
import {
  DETERMINISTIC_BOUND,
  digitSum,
  euclideanMod,
  floorDiv,
  gcd,
  isPrime,
  isPrimeDetailed,
  isqrt,
  isSquare,
  lcm,
  numDivisors,
  popcount,
  sumDivisors,
} from './arith.js';

describe('isqrt', () => {
  it('is exact on perfect squares', () => {
    for (const n of [0n, 1n, 4n, 9n, 1681n, 10n ** 40n]) {
      const r = isqrt(n);
      expect(r * r).toBe(n);
    }
  });

  it('floors on non-squares', () => {
    expect(isqrt(8n)).toBe(2n);
    expect(isqrt(99n)).toBe(9n);
    expect(isqrt(10n ** 41n)).toBe(316227766016837933199n);
    // and it really is the floor: the next integer up overshoots
    expect(316227766016837933199n ** 2n).toBeLessThanOrEqual(10n ** 41n);
    expect(316227766016837933200n ** 2n).toBeGreaterThan(10n ** 41n);
  });

  it('agrees with Math.sqrt across a range where floats are still trustworthy', () => {
    for (let n = 0; n < 5000; n += 7) {
      expect(isqrt(BigInt(n))).toBe(BigInt(Math.floor(Math.sqrt(n))));
    }
  });

  it('rejects negatives rather than returning nonsense', () => {
    expect(() => isqrt(-1n)).toThrow(RangeError);
  });
});

describe('isSquare', () => {
  it('recognises 41 squared, the Euler polynomial counterexample', () => {
    expect(isSquare(1681n)).toBe(true);
    expect(isSquare(1680n)).toBe(false);
  });

  it('is false for negatives', () => {
    expect(isSquare(-4n)).toBe(false);
  });
});

describe('isPrime', () => {
  it('agrees with a sieve below 10,000', () => {
    const limit = 10_000;
    const sieve = new Uint8Array(limit + 1).fill(1);
    sieve[0] = 0;
    sieve[1] = 0;
    for (let i = 2; i * i <= limit; i += 1) {
      if (sieve[i]) for (let j = i * i; j <= limit; j += i) sieve[j] = 0;
    }
    for (let n = 0; n <= limit; n += 1) {
      expect(isPrime(BigInt(n))).toBe(sieve[n] === 1);
    }
  });

  it('handles negatives and zero', () => {
    expect(isPrime(-7n)).toBe(false);
    expect(isPrime(0n)).toBe(false);
    expect(isPrime(1n)).toBe(false);
  });

  it('knows 2047 = 23 · 89 is composite, the classic base-2 pseudoprime', () => {
    expect(isPrime(2047n)).toBe(false);
  });

  it('handles Carmichael numbers that fool naive Fermat tests', () => {
    for (const n of [561n, 1105n, 1729n, 2465n, 6601n, 62745n]) {
      expect(isPrime(n)).toBe(false);
    }
  });

  it('recognises a large Mersenne prime', () => {
    expect(isPrime(2n ** 127n - 1n)).toBe(true);
  });

  it('reports a decision below the deterministic bound and a probable-prime above it', () => {
    expect(isPrimeDetailed(97n).probabilistic).toBe(false);
    const big = DETERMINISTIC_BOUND + 1n;
    expect(isPrimeDetailed(big).probabilistic).toBe(!isPrimeDetailed(big).prime ? false : true);
    // A large prime above the bound must be flagged rather than asserted.
    expect(isPrimeDetailed(2n ** 521n - 1n)).toEqual({ prime: true, probabilistic: true });
  });
});

describe('divisibility helpers', () => {
  it('computes gcd and lcm, including with zero and negatives', () => {
    expect(gcd(12n, 18n)).toBe(6n);
    expect(gcd(-12n, 18n)).toBe(6n);
    expect(gcd(0n, 5n)).toBe(5n);
    expect(lcm(4n, 6n)).toBe(12n);
    expect(lcm(0n, 6n)).toBe(0n);
  });

  it('floors division rather than truncating toward zero', () => {
    expect(floorDiv(7n, 2n)).toBe(3n);
    expect(floorDiv(-7n, 2n)).toBe(-4n);
    expect(7n / 2n).toBe(3n);
    expect(-7n / 2n).toBe(-3n); // BigInt truncates; floorDiv deliberately differs
  });

  it('keeps the remainder non-negative, as number theory expects', () => {
    expect(euclideanMod(-1n, 7n)).toBe(6n);
    expect(euclideanMod(8n, 7n)).toBe(1n);
  });

  it('counts and sums divisors', () => {
    expect(numDivisors(28n).value).toBe(6n);
    expect(sumDivisors(28n).value).toBe(56n); // perfect: sigma(n) = 2n
    expect(numDivisors(1n).value).toBe(1n);
  });

  it('counts bits and digits', () => {
    expect(popcount(255n)).toBe(8n);
    expect(digitSum(1681n)).toBe(16n);
    expect(digitSum(255n, 2n)).toBe(8n);
  });
});
