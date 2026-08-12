import { describe, expect, it } from 'vitest';
import {
  isProvedWithReceipt,
  isReceiptCurrent,
  pinLabel,
  pinsEqual,
  stalenessReasons,
  type Pin,
  type Receipt,
} from './receipt.js';
import { reportAxioms, STANDARD_AXIOMS } from './trust.js';

const pin: Pin = {
  toolchain: 'leanprover/lean4:v4.9.0',
  mathlibRev: 'a1b2c3d4e5f6a7b8c9d0',
  dependencies: { mathlib: 'a1b2c3d4e5f6a7b8c9d0', batteries: 'deadbeef' },
  capturedAt: '2026-01-01T00:00:00.000Z',
};

const receipt: Receipt = {
  engine: 'lean-process',
  method: 'lean-kernel',
  scope: null,
  declaration: 'tail_bound',
  pin,
  axioms: reportAxioms([...STANDARD_AXIOMS]),
  sorryCount: 0,
  accepted: true,
  elapsedMs: 1800,
  heartbeats: { used: 31000, budget: 200000 },
  verifiedAt: '2026-01-01T00:00:00.000Z',
};

describe('pinsEqual', () => {
  it('is true for identical pins', () => {
    expect(pinsEqual(pin, { ...pin, capturedAt: 'later' })).toBe(true);
  });

  it('is false when the toolchain moves', () => {
    expect(pinsEqual(pin, { ...pin, toolchain: 'leanprover/lean4:v4.10.0' })).toBe(false);
  });

  it('is false when Mathlib moves', () => {
    expect(pinsEqual(pin, { ...pin, mathlibRev: 'ffffff' })).toBe(false);
  });

  it('is false when a dependency is added or removed', () => {
    expect(pinsEqual(pin, { ...pin, dependencies: { mathlib: pin.mathlibRev! } })).toBe(false);
  });

  it('treats two absent pins as equal and one absent pin as different', () => {
    expect(pinsEqual(null, null)).toBe(true);
    expect(pinsEqual(pin, null)).toBe(false);
  });
});

describe('isProvedWithReceipt', () => {
  it('requires a receipt at all — a proof without one is unverified', () => {
    expect(isProvedWithReceipt(null)).toBe(false);
    expect(isProvedWithReceipt(undefined)).toBe(false);
  });

  it('requires the kernel to have accepted the term', () => {
    expect(isProvedWithReceipt({ ...receipt, accepted: false })).toBe(false);
  });

  it('requires zero sorries', () => {
    expect(isProvedWithReceipt({ ...receipt, sorryCount: 1 })).toBe(false);
  });

  it('rejects a receipt whose axiom report reaches sorryAx', () => {
    expect(
      isProvedWithReceipt({ ...receipt, axioms: reportAxioms(['propext', 'sorryAx']) }),
    ).toBe(false);
  });

  it('accepts a clean receipt', () => {
    expect(isProvedWithReceipt(receipt)).toBe(true);
  });
});

describe('isReceiptCurrent', () => {
  it('is false with no pin, because nothing can be current against nothing', () => {
    expect(isReceiptCurrent(receipt, null)).toBe(false);
  });

  it('is true when the receipt matches the pin', () => {
    expect(isReceiptCurrent(receipt, pin)).toBe(true);
  });

  it('is false after a Mathlib bump', () => {
    expect(isReceiptCurrent(receipt, { ...pin, mathlibRev: 'newrev0000' })).toBe(false);
  });

  it('keeps an exhaustion result current through a Mathlib bump, and with no pin at all', () => {
    // Exhaustion is arithmetic over a finite space. It does not rest on the
    // library, so marking it stale would be noise — and noise in the stale
    // marker is how a genuinely stale proof gets ignored.
    const exhausted = { ...receipt, method: 'exhaustion' as const, engine: 'exhaustive-search' as const };
    expect(isReceiptCurrent(exhausted, { ...pin, mathlibRev: 'newrev0000' })).toBe(true);
    expect(isReceiptCurrent(exhausted, null)).toBe(true);
  });
});

describe('stalenessReasons', () => {
  it('names the toolchain change', () => {
    const reasons = stalenessReasons(receipt, { ...pin, toolchain: 'leanprover/lean4:v4.10.0' });
    expect(reasons).toEqual([
      {
        field: 'toolchain',
        name: 'lean-toolchain',
        was: 'leanprover/lean4:v4.9.0',
        now: 'leanprover/lean4:v4.10.0',
      },
    ]);
  });

  it('names a Mathlib bump with both revisions', () => {
    const reasons = stalenessReasons(receipt, {
      ...pin,
      mathlibRev: 'ffff1111',
      dependencies: { ...pin.dependencies, mathlib: 'ffff1111' },
    });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatchObject({ field: 'mathlib', was: pin.mathlibRev, now: 'ffff1111' });
  });

  it('reports a dependency appearing as was:absent', () => {
    const reasons = stalenessReasons(receipt, {
      ...pin,
      dependencies: { ...pin.dependencies, aesop: '1234' },
    });
    expect(reasons).toEqual([
      { field: 'dependency', name: 'aesop', was: 'absent', now: '1234' },
    ]);
  });

  it('finds nothing when the environment is unchanged', () => {
    expect(stalenessReasons(receipt, pin)).toEqual([]);
  });
});

describe('pinLabel', () => {
  it('shortens the toolchain and abbreviates the revision', () => {
    expect(pinLabel(pin)).toBe('lean v4.9.0 · Mathlib @ a1b2c3d');
  });

  it('says so plainly when nothing is pinned', () => {
    expect(pinLabel(null)).toBe('no project pinned');
  });
});
