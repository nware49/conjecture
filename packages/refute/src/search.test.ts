import { describe, expect, it } from 'vitest';
import { EXAMPLES, findExample } from './library.js';
import { describeOutcome, runSearch, spaceSize, verifyWitness, type SearchRequest } from './search.js';

const base: Omit<SearchRequest, 'definitions' | 'predicate' | 'variables'> = {
  strategy: 'enumerate',
  budgetMs: 20_000,
  maxCandidates: 2_000_000,
};

describe('runSearch', () => {
  it('finds the smallest counterexample to Euler’s polynomial at n = 40', async () => {
    const outcome = await runSearch({
      ...base,
      definitions: 'p(n) = n ^ 2 + n + 41',
      predicate: 'isPrime(p(n))',
      variables: [{ name: 'n', from: 0n, to: 1000n }],
      report: [{ label: 'value', expr: 'p(n)' }],
    });
    expect(outcome.kind).toBe('witness');
    if (outcome.kind !== 'witness') return;
    expect(outcome.witness.assignment).toEqual({ n: '40' });
    expect(outcome.witness.evaluation).toContain('1681');
    // 41 candidates checked means it stopped the moment it found one.
    expect(outcome.candidatesChecked).toBe(41);
  });

  it('finds 2^11 - 1 = 2047 as the first composite Mersenne at a prime exponent', async () => {
    const outcome = await runSearch({
      ...base,
      definitions: 'm(p) = 2 ^ p - 1',
      predicate: '!isPrime(p) || isPrime(m(p))',
      variables: [{ name: 'p', from: 2n, to: 100n }],
      report: [{ label: '2^p − 1', expr: 'm(p)' }],
    });
    expect(outcome.kind).toBe('witness');
    if (outcome.kind !== 'witness') return;
    expect(outcome.witness.assignment).toEqual({ p: '11' });
    expect(outcome.witness.evaluation).toContain('2047');
  });

  it('reports exhaustion when the whole declared space holds', async () => {
    const outcome = await runSearch({
      ...base,
      definitions: '',
      predicate: 'n * n >= 0',
      variables: [{ name: 'n', from: 0n, to: 500n }],
    });
    expect(outcome.kind).toBe('exhausted');
    expect(outcome.candidatesChecked).toBe(501);
  });

  it('distinguishes running out of candidates from checking the whole space', async () => {
    const outcome = await runSearch({
      ...base,
      maxCandidates: 100,
      definitions: '',
      predicate: 'n >= 0',
      variables: [{ name: 'n', from: 0n, to: 1_000_000n }],
    });
    expect(outcome.kind).toBe('budget');
    if (outcome.kind !== 'budget') return;
    expect(outcome.reason).toBe('candidates');
    expect(outcome.candidatesChecked).toBe(100);
  });

  it('stops at the time budget and says so', async () => {
    let clock = 0;
    const outcome = await runSearch(
      {
        ...base,
        budgetMs: 50,
        definitions: '',
        predicate: 'n >= 0',
        variables: [{ name: 'n', from: 0n, to: 10_000_000n }],
      },
      { now: () => (clock += 10) },
    );
    expect(outcome.kind).toBe('budget');
    if (outcome.kind !== 'budget') return;
    expect(outcome.reason).toBe('time');
  });

  it('searches multiple variables with the last one moving fastest', async () => {
    const outcome = await runSearch({
      ...base,
      definitions: '',
      predicate: '!(a == 2 && b == 1)',
      variables: [
        { name: 'a', from: 0n, to: 5n },
        { name: 'b', from: 0n, to: 5n },
      ],
    });
    expect(outcome.kind).toBe('witness');
    if (outcome.kind !== 'witness') return;
    expect(outcome.witness.assignment).toEqual({ a: '2', b: '1' });
    // a=0 (6 rows), a=1 (6 rows), then a=2,b=0 and a=2,b=1.
    expect(outcome.candidatesChecked).toBe(14);
  });

  it('honours a step so a space can skip values', async () => {
    const outcome = await runSearch({
      ...base,
      definitions: '',
      predicate: 'n % 2 == 0',
      variables: [{ name: 'n', from: 0n, to: 100n, step: 2n }],
    });
    expect(outcome.kind).toBe('exhausted');
    expect(outcome.candidatesChecked).toBe(51);
  });

  it('keeps a trace of recent candidates, with the failing row last', async () => {
    const outcome = await runSearch({
      ...base,
      definitions: 'p(n) = n ^ 2 + n + 41',
      predicate: 'isPrime(p(n))',
      variables: [{ name: 'n', from: 0n, to: 1000n }],
      report: [{ label: 'value', expr: 'p(n)' }],
      traceSize: 4,
    });
    if (outcome.kind !== 'witness') throw new Error('expected a witness');
    expect(outcome.trace).toHaveLength(4);
    expect(outcome.trace.map((r) => r.assignment['n'])).toEqual(['37', '38', '39', '40']);
    expect(outcome.trace.map((r) => r.holds)).toEqual([true, true, true, false]);
    expect(outcome.trace.at(-1)?.values['value']).toBe('1681');
  });

  it('reports a parse error with a position instead of failing silently', async () => {
    const outcome = await runSearch({
      ...base,
      definitions: 'f(n) = n +',
      predicate: 'f(n) > 0',
      variables: [{ name: 'n', from: 0n, to: 10n }],
    });
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.position?.line).toBe(1);
  });

  it('reports an empty space as exhausted, not as a witness', async () => {
    const outcome = await runSearch({
      ...base,
      definitions: '',
      predicate: 'n > 0',
      variables: [{ name: 'n', from: 10n, to: 0n }],
    });
    expect(outcome.kind).toBe('exhausted');
    expect(outcome.candidatesChecked).toBe(0);
  });

  it('can be cancelled mid-search', async () => {
    const controller = new AbortController();
    controller.abort();
    const outcome = await runSearch(
      {
        ...base,
        definitions: '',
        predicate: 'n >= 0',
        variables: [{ name: 'n', from: 0n, to: 10_000_000n }],
      },
      { signal: controller.signal },
    );
    expect(outcome.kind).toBe('budget');
    expect(outcome.candidatesChecked).toBe(0);
  });

  it('reports progress while it runs', async () => {
    let clock = 0;
    const seen: number[] = [];
    await runSearch(
      {
        ...base,
        maxCandidates: 40,
        definitions: '',
        predicate: 'n >= 0',
        variables: [{ name: 'n', from: 0n, to: 10_000n }],
      },
      { now: () => (clock += 200), onProgress: (p) => seen.push(p.candidatesChecked) },
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBeLessThanOrEqual(40);
  });

  it('finds a distant witness by random sampling that enumeration would not reach', async () => {
    const outcome = await runSearch({
      ...base,
      strategy: 'random',
      maxCandidates: 20_000,
      seed: 12345,
      definitions: '',
      predicate: 'n % 1000 != 0 || n == 0',
      variables: [{ name: 'n', from: 0n, to: 100_000n }],
    });
    expect(outcome.kind).toBe('witness');
  });

  it('reproduces exactly for a given seed', async () => {
    const request: SearchRequest = {
      ...base,
      strategy: 'random',
      maxCandidates: 500,
      seed: 99,
      definitions: '',
      predicate: 'n % 7919 != 0',
      variables: [{ name: 'n', from: 1n, to: 1_000_000n }],
    };
    const a = await runSearch(request);
    const b = await runSearch(request);
    expect(a.kind).toBe(b.kind);
    expect(a.candidatesChecked).toBe(b.candidatesChecked);
  });
});

describe('the independent re-check', () => {
  it('confirms a genuine witness', () => {
    const result = verifyWitness(
      {
        ...base,
        definitions: 'p(n) = n ^ 2 + n + 41',
        predicate: 'isPrime(p(n))',
        variables: [{ name: 'n', from: 0n, to: 100n }],
      },
      { n: '40' },
    );
    expect(result.holds).toBe(false); // the claim fails there, so it is a witness
  });

  it('reports that a non-witness holds', () => {
    const result = verifyWitness(
      {
        ...base,
        definitions: 'p(n) = n ^ 2 + n + 41',
        predicate: 'isPrime(p(n))',
        variables: [{ name: 'n', from: 0n, to: 100n }],
      },
      { n: '39' },
    );
    expect(result.holds).toBe(true);
  });
});

describe('spaceSize', () => {
  it('multiplies the variable ranges exactly, past Number.MAX_SAFE_INTEGER', () => {
    expect(spaceSize([{ name: 'n', from: 0n, to: 9n }])).toBe(10n);
    expect(
      spaceSize([
        { name: 'a', from: 1n, to: 10n ** 12n },
        { name: 'b', from: 1n, to: 10n ** 12n },
      ]),
    ).toBe(10n ** 24n);
  });

  it('is zero for an empty range', () => {
    expect(spaceSize([{ name: 'n', from: 5n, to: 1n }])).toBe(0n);
  });
});

describe('describeOutcome', () => {
  it('never claims an exhausted search proved anything', async () => {
    const outcome = await runSearch({
      ...base,
      definitions: '',
      predicate: 'n >= 0',
      variables: [{ name: 'n', from: 0n, to: 10n }],
    });
    const sentence = describeOutcome(outcome);
    expect(sentence).toContain('not proved');
    expect(sentence).toContain('unrefuted');
  });

  it('says a stopped search leaves the claim open', async () => {
    const outcome = await runSearch({
      ...base,
      maxCandidates: 5,
      definitions: '',
      predicate: 'n >= 0',
      variables: [{ name: 'n', from: 0n, to: 10_000n }],
    });
    expect(describeOutcome(outcome)).toContain('stays open');
  });
});

describe('the seeded example library', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))(
    '%s behaves as documented',
    async (_id, example) => {
      const outcome = await runSearch(example.request);
      expect(outcome.kind).toBe(example.expect);
    },
    60_000,
  );

  it('finds Euler’s counterexample at exactly n = 40', async () => {
    const outcome = await runSearch(findExample('euler_polynomial')!.request);
    if (outcome.kind !== 'witness') throw new Error('expected a witness');
    expect(outcome.witness.assignment['n']).toBe('40');
  });

  it('finds the Mersenne counterexample at exactly p = 11', async () => {
    const outcome = await runSearch(findExample('mersenne_prime_exponent')!.request);
    if (outcome.kind !== 'witness') throw new Error('expected a witness');
    expect(outcome.witness.assignment['p']).toBe('11');
  });
});
