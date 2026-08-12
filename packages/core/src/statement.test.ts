import { describe, expect, it } from 'vitest';
import {
  confirmSync,
  editLean,
  editProse,
  emptyStatement,
  isElaborable,
  syncState,
} from './statement.js';

describe('statement sync', () => {
  it('starts synced and empty', () => {
    expect(syncState(emptyStatement())).toBe('synced');
  });

  it('flags the Lean as behind when the prose is edited', () => {
    const s = editProse(emptyStatement(), 'For every natural number n, f(n) is at most 2n.');
    expect(syncState(s)).toBe('lean-behind');
  });

  it('flags the prose as behind when the Lean is edited', () => {
    const s = editLean(emptyStatement(), 'theorem tail_bound (n : ℕ) : f n ≤ 2 * n');
    expect(syncState(s)).toBe('prose-behind');
  });

  it('reports divergence when both were edited separately', () => {
    let s = editProse(emptyStatement(), 'prose');
    s = editLean(s, 'lean');
    expect(syncState(s)).toBe('diverged');
  });

  it('returns to synced only when a human confirms the two agree', () => {
    let s = editProse(emptyStatement(), 'prose');
    s = editLean(s, 'lean');
    expect(syncState(confirmSync(s))).toBe('synced');
  });

  it('does not bump the revision when an edit changes nothing', () => {
    const s = editProse(emptyStatement(), 'same');
    expect(editProse(s, 'same')).toBe(s);
  });

  it('goes out of sync again after a later edit', () => {
    let s = confirmSync(editProse(emptyStatement(), 'prose'));
    s = editProse(s, 'prose, revised');
    expect(syncState(s)).toBe('lean-behind');
  });
});

describe('isElaborable', () => {
  it('is false for a prose-only claim, which is allowed but uncheckable', () => {
    expect(isElaborable(editProse(emptyStatement(), 'Some claim.'))).toBe(false);
  });

  it('ignores whitespace-only Lean', () => {
    expect(isElaborable(editLean(emptyStatement(), '   \n\t '))).toBe(false);
  });

  it('is true once there is Lean to hand over', () => {
    expect(isElaborable(editLean(emptyStatement(), 'theorem t : True := trivial'))).toBe(true);
  });
});
