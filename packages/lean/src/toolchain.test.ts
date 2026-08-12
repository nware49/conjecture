import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { connectProject } from './connect.js';
import { countSorries, pinFrom, probeProject, toolchainVersion } from './toolchain.js';
import type { CommandRunner, RunResult } from './runner.js';

const roots: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'conjecture-lean-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const MANIFEST = JSON.stringify({
  version: '1.1.0',
  packages: [
    { name: 'mathlib', rev: 'a1b2c3d4e5f6a7b8c9d0e1f2' },
    { name: 'batteries', rev: 'deadbeefcafe' },
  ],
});

class ReadyRunner implements CommandRunner {
  async run(): Promise<RunResult> {
    return {
      stdout: 'Lake version 5.0.0 (Lean 4.9.0)',
      stderr: '',
      code: 0,
      timedOut: false,
      spawnFailed: false,
      elapsedMs: 5,
    };
  }
}

class MissingRunner implements CommandRunner {
  async run(): Promise<RunResult> {
    return {
      stdout: '',
      stderr: 'spawn lake ENOENT',
      code: null,
      timedOut: false,
      spawnFailed: true,
      elapsedMs: 1,
    };
  }
}

describe('probeProject', () => {
  it('reads the toolchain and dependency revisions from the repository', async () => {
    const root = await makeProject({
      'lean-toolchain': 'leanprover/lean4:v4.9.0\n',
      'lakefile.lean': 'import Lake\n',
      'lake-manifest.json': MANIFEST,
    });
    const probe = await probeProject(root);
    expect(probe.toolchain).toBe('leanprover/lean4:v4.9.0');
    expect(probe.lakefile).toBe('lakefile.lean');
    expect(probe.problems).toEqual([]);

    const pin = pinFrom(probe);
    expect(pin?.mathlibRev).toBe('a1b2c3d4e5f6a7b8c9d0e1f2');
    expect(pin?.dependencies['batteries']).toBe('deadbeefcafe');
  });

  it('accepts a toml lakefile', async () => {
    const root = await makeProject({
      'lean-toolchain': 'leanprover/lean4:v4.12.0',
      'lakefile.toml': 'name = "proj"',
      'lake-manifest.json': MANIFEST,
    });
    expect((await probeProject(root)).lakefile).toBe('lakefile.toml');
  });

  it('refuses to pin a project with no lean-toolchain rather than guessing one', async () => {
    const root = await makeProject({ 'lakefile.lean': 'import Lake', 'lake-manifest.json': MANIFEST });
    const probe = await probeProject(root);
    expect(pinFrom(probe)).toBeNull();
    expect(probe.problems[0]).toContain('cannot be pinned');
  });

  it('reports a malformed manifest instead of silently pinning nothing', async () => {
    const root = await makeProject({
      'lean-toolchain': 'leanprover/lean4:v4.9.0',
      'lakefile.lean': 'import Lake',
      'lake-manifest.json': '{ not json',
    });
    const probe = await probeProject(root);
    expect(probe.problems.some((p) => p.includes('could not be parsed'))).toBe(true);
    // Still pinnable on the toolchain alone, with no dependencies recorded.
    expect(pinFrom(probe)?.mathlibRev).toBeNull();
  });

  it('records no Mathlib when the project does not depend on it', async () => {
    const root = await makeProject({
      'lean-toolchain': 'leanprover/lean4:v4.9.0',
      'lakefile.lean': 'import Lake',
      'lake-manifest.json': JSON.stringify({ packages: [{ name: 'batteries', rev: 'abc' }] }),
    });
    expect(pinFrom(await probeProject(root))?.mathlibRev).toBeNull();
  });
});

describe('toolchainVersion', () => {
  it('extracts a version for display', () => {
    expect(toolchainVersion('leanprover/lean4:v4.9.0')).toBe('4.9.0');
    expect(toolchainVersion('leanprover/lean4:v4.13.0-rc3')).toBe('4.13.0-rc3');
  });

  it('returns null for a nightly rather than inventing a number', () => {
    expect(toolchainVersion('leanprover/lean4:nightly-2026-01-01')).toBeNull();
  });
});

describe('countSorries', () => {
  it('counts holes and ignores commented ones', () => {
    expect(countSorries('by sorry\n-- sorry\nby sorry')).toBe(2);
  });

  it('does not count a longer identifier containing the word', () => {
    expect(countSorries('def sorryState := 1')).toBe(0);
  });
});

describe('connectProject', () => {
  it('reports each step and opens the workspace when everything lines up', async () => {
    const root = await makeProject({
      'lean-toolchain': 'leanprover/lean4:v4.9.0',
      'lakefile.lean': 'import Lake',
      'lake-manifest.json': MANIFEST,
      'TailBounds/Main.lean': 'theorem t : True := trivial',
    });
    const result = await connectProject({ root, runner: new ReadyRunner() });
    expect(result.ready).toBe(true);
    expect(result.pin?.toolchain).toBe('leanprover/lean4:v4.9.0');
    expect(result.steps.map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(result.leanFiles).toBe(1);
  });

  it('surfaces sorries already in the repository as pre-existing gaps', async () => {
    const root = await makeProject({
      'lean-toolchain': 'leanprover/lean4:v4.9.0',
      'lakefile.lean': 'import Lake',
      'lake-manifest.json': MANIFEST,
      'TailBounds/Main.lean': 'theorem a : True := by sorry\ntheorem b : True := by sorry',
    });
    const result = await connectProject({ root, runner: new ReadyRunner() });
    expect(result.inheritedSorries).toBe(2);
    const gaps = result.steps.find((s) => s.label === 'Existing gaps')!;
    expect(gaps.state).toBe('partial');
    expect(gaps.detail).toContain('2 sorry');
  });

  it('skips build directories when counting, so vendored code is not blamed on you', async () => {
    const root = await makeProject({
      'lean-toolchain': 'leanprover/lean4:v4.9.0',
      'lakefile.lean': 'import Lake',
      'lake-manifest.json': MANIFEST,
      'Main.lean': 'theorem a : True := trivial',
      '.lake/packages/mathlib/Mathlib/Thing.lean': 'theorem vendored : True := by sorry',
    });
    const result = await connectProject({ root, runner: new ReadyRunner() });
    expect(result.inheritedSorries).toBe(0);
    expect(result.leanFiles).toBe(1);
  });

  it('is not ready when lake is missing, but still reports the pin it could read', async () => {
    const root = await makeProject({
      'lean-toolchain': 'leanprover/lean4:v4.9.0',
      'lakefile.lean': 'import Lake',
      'lake-manifest.json': MANIFEST,
    });
    const result = await connectProject({ root, runner: new MissingRunner() });
    expect(result.ready).toBe(false);
    expect(result.pin).not.toBeNull();
    expect(result.health.status).toBe('unavailable');
    expect(result.steps.find((s) => s.label === 'Lean server')!.state).toBe('failed');
  });

  it('fails cleanly on a directory that does not exist', async () => {
    const result = await connectProject({ root: '/definitely/not/here', runner: new ReadyRunner() });
    expect(result.ready).toBe(false);
    expect(result.engine.kind).toBe('unavailable');
    expect(result.steps[0]!.state).toBe('failed');
  });

  it('gives an unpinnable directory an engine that refuses everything', async () => {
    const root = await makeProject({ 'README.md': 'not a Lean project' });
    const result = await connectProject({ root, runner: new ReadyRunner() });
    expect(result.ready).toBe(false);
    expect(result.engine.kind).toBe('unavailable');
    expect((await result.engine.elaborate({} as never)).message).toBeTruthy();
  });
});
