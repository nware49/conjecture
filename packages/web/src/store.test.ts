import { describe, expect, it } from 'vitest';
import { parseRoute } from './store.js';

describe('parseRoute', () => {
  it('defaults to the workspace', () => {
    expect(parseRoute('')).toEqual({ name: 'workspace' });
    expect(parseRoute('#/')).toEqual({ name: 'workspace' });
    expect(parseRoute('#')).toEqual({ name: 'workspace' });
  });

  it('reads the named screens', () => {
    expect(parseRoute('#/graph')).toEqual({ name: 'graph' });
    expect(parseRoute('#/connect')).toEqual({ name: 'connect' });
    expect(parseRoute('#/trust')).toEqual({ name: 'trust' });
  });

  it('reads an id off the bench and share routes', () => {
    expect(parseRoute('#/bench/abc-123')).toEqual({ name: 'bench', searchId: 'abc-123' });
    expect(parseRoute('#/share/xyz')).toEqual({ name: 'share', claimId: 'xyz' });
  });

  it('leaves the id null when the route carries none', () => {
    expect(parseRoute('#/bench')).toEqual({ name: 'bench', searchId: null });
    expect(parseRoute('#/share')).toEqual({ name: 'share', claimId: null });
  });

  it('falls back to the workspace for anything unrecognised', () => {
    expect(parseRoute('#/nonsense/deep/path')).toEqual({ name: 'workspace' });
  });

  it('tolerates a missing leading slash and trailing slashes', () => {
    expect(parseRoute('#graph')).toEqual({ name: 'graph' });
    expect(parseRoute('#/graph/')).toEqual({ name: 'graph' });
  });
});
