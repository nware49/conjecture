import { describe, expect, it } from 'vitest';
import { makeClaim } from './claim.js';
import { asClaimId, asProjectId, asStepId, leanDeclName, slugify, uniqueSlug } from './ids.js';
import { makeStep } from './proof.js';
import type { Pin, Receipt } from './receipt.js';
import { reportAxioms, STANDARD_AXIOMS } from './trust.js';
import {
  canVerify,
  libraryCounts,
  verificationBlockedReason,
  type Project,
  type Workspace,
} from './workspace.js';

const pin: Pin = {
  toolchain: 'leanprover/lean4:v4.9.0',
  mathlibRev: 'a1b2c3d',
  dependencies: { mathlib: 'a1b2c3d' },
  capturedAt: '2026-01-01T00:00:00.000Z',
};

const project: Project = {
  id: asProjectId('p1'),
  name: 'tail-bounds',
  root: '/tmp/tail-bounds',
  source: { kind: 'git', url: 'https://example.invalid/tail-bounds', branch: 'main' },
  pin,
  inheritedSorries: 2,
  limits: { maxHeartbeats: 200000, elaborationTimeoutMs: 60000 },
};

const receipt: Receipt = {
  engine: 'lean-process',
  declaration: 'proved_one',
  pin,
  axioms: reportAxioms([...STANDARD_AXIOMS]),
  sorryCount: 0,
  kernelAccepted: true,
  elapsedMs: 400,
  heartbeats: null,
  verifiedAt: '2026-01-01T00:00:00.000Z',
};

describe('libraryCounts', () => {
  it('counts each glyph bucket and totals the sorries exactly', () => {
    const claims = [
      makeClaim(asClaimId('a'), 'Open', 'open_claim'),
      makeClaim(asClaimId('b'), 'Proved', 'proved_one', {
        elaborates: true,
        steps: [makeStep(asStepId('s'), 'x', { kernelOk: true })],
        receipt,
      }),
    ];
    const counts = libraryCounts(claims, pin);
    expect(counts.total).toBe(2);
    expect(counts.byState.proved).toBe(1);
    expect(counts.byState.open).toBe(1);
    expect(counts.provedFraction).toBe(0.5);
    expect(counts.totalSorries).toBe(0);
  });

  it('is safe on an empty library', () => {
    const counts = libraryCounts([], null);
    expect(counts.total).toBe(0);
    expect(counts.provedFraction).toBe(0);
  });
});

describe('the empty-state rule', () => {
  const noProject: Workspace = {
    project: null,
    claims: [],
    engine: { status: 'unavailable', kind: 'unavailable', reason: 'No Lean toolchain on PATH.' },
  };

  it('will not verify without a project', () => {
    expect(canVerify(noProject)).toBe(false);
    expect(verificationBlockedReason(noProject)).toContain('No project connected');
  });

  it('will not verify when the engine is missing, even with a project pinned', () => {
    const ws: Workspace = {
      project,
      claims: [],
      engine: { status: 'unavailable', kind: 'unavailable', reason: 'lake not found on PATH.' },
    };
    expect(canVerify(ws)).toBe(false);
    expect(verificationBlockedReason(ws)).toBe('lake not found on PATH.');
  });

  it('will not verify while the project is still building', () => {
    const ws: Workspace = {
      project,
      claims: [],
      engine: { status: 'building', kind: 'lean-process', detail: 'lake exe cache get' },
    };
    expect(canVerify(ws)).toBe(false);
    expect(verificationBlockedReason(ws)).toBe('Building: lake exe cache get');
  });

  it('will not verify when the project has no readable toolchain to pin against', () => {
    const ws: Workspace = {
      project: { ...project, pin: null },
      claims: [],
      engine: { status: 'ready', kind: 'lean-process', detail: 'lean 4.9.0' },
    };
    expect(canVerify(ws)).toBe(false);
    expect(verificationBlockedReason(ws)).toContain('lean-toolchain');
  });

  it('verifies when a pinned project and a ready engine are both present', () => {
    const ws: Workspace = {
      project,
      claims: [],
      engine: { status: 'ready', kind: 'lean-process', detail: 'lean 4.9.0' },
    };
    expect(canVerify(ws)).toBe(true);
    expect(verificationBlockedReason(ws)).toBeNull();
  });
});

describe('ids', () => {
  it('slugifies titles into something legible', () => {
    expect(slugify('Tail bound for f')).toBe('tail_bound_for_f');
    expect(slugify('Erdős–Ko–Rado')).toBe('erdos_ko_rado');
  });

  it('never produces an empty slug', () => {
    expect(slugify('···')).toBe('claim');
  });

  it('disambiguates against names already in use', () => {
    expect(uniqueSlug('Tail bound', ['tail_bound'])).toBe('tail_bound_2');
    expect(uniqueSlug('Tail bound', ['tail_bound', 'tail_bound_2'])).toBe('tail_bound_3');
  });

  it('produces a Lean-legal declaration name from a title starting with a digit', () => {
    expect(leanDeclName('2-adic bound')).toBe('c_2_adic_bound');
    expect(leanDeclName('Tail bound')).toBe('tail_bound');
  });
});
