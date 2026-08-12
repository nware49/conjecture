import { describe, expect, it } from 'vitest';
import { buildSource, isEngineError, unshiftDiagnostic, type ElaborateRequest } from './engine.js';
import { parseJsonOutput } from './diagnostics.js';
import { ProcessLeanEngine, UnavailableLeanEngine } from './process-engine.js';
import type { CommandRunner, RunRequest, RunResult } from './runner.js';

/** A runner that replays canned output, so engine logic is testable without Lean. */
class FakeRunner implements CommandRunner {
  readonly calls: RunRequest[] = [];

  constructor(private readonly responses: (request: RunRequest) => Partial<RunResult>) {}

  async run(request: RunRequest): Promise<RunResult> {
    this.calls.push(request);
    return {
      stdout: '',
      stderr: '',
      code: 0,
      timedOut: false,
      spawnFailed: false,
      elapsedMs: 12,
      ...this.responses(request),
    };
  }
}

const request: ElaborateRequest = {
  relativePath: 'Scratch.lean',
  source: 'theorem tail_bound (n : ℕ) : f n ≤ 2 * n := by\n  sorry',
  declaration: 'tail_bound',
  maxHeartbeats: 200_000,
  timeoutMs: 60_000,
};

const writes: { path: string; contents: string }[] = [];
const captureWrite = async (path: string, contents: string): Promise<void> => {
  writes.push({ path, contents });
};

function engineWith(responses: (request: RunRequest) => Partial<RunResult>): {
  engine: ProcessLeanEngine;
  runner: FakeRunner;
} {
  const runner = new FakeRunner(responses);
  const engine = new ProcessLeanEngine({
    root: '/proj',
    runner,
    writeFileImpl: captureWrite,
  });
  return { engine, runner };
}

describe('buildSource', () => {
  it('pins the heartbeat budget and appends the axiom query', () => {
    const { text, headerLines } = buildSource(request);
    expect(text.startsWith('set_option maxHeartbeats 200000')).toBe(true);
    expect(text.trimEnd().endsWith('#print axioms tail_bound')).toBe(true);
    expect(headerLines).toBe(2);
  });

  it('omits the axiom query when there is no declaration to ask about', () => {
    const { text } = buildSource({ ...request, declaration: null });
    expect(text).not.toContain('#print axioms');
  });
});

describe('position mapping', () => {
  it('shifts diagnostics back into the user’s own line numbers', () => {
    const { diagnostics } = parseJsonOutput(
      JSON.stringify({ severity: 'error', pos: { line: 9, column: 4 }, data: 'boom' }),
    );
    const shifted = unshiftDiagnostic(diagnostics[0]!, 2);
    expect(shifted.range.start).toEqual({ line: 7, column: 4 });
  });

  it('never shifts a position above line 1', () => {
    const { diagnostics } = parseJsonOutput(
      JSON.stringify({ severity: 'error', pos: { line: 1, column: 0 }, data: 'boom' }),
    );
    expect(unshiftDiagnostic(diagnostics[0]!, 2).range.start.line).toBe(1);
  });
});

describe('health', () => {
  it('is ready when lake answers', async () => {
    const { engine } = engineWith(() => ({ stdout: 'Lake version 5.0.0 (Lean 4.9.0)\n' }));
    const health = await engine.health();
    expect(health.status).toBe('ready');
    if (health.status === 'ready') expect(health.detail).toContain('Lake version');
  });

  it('explains how to fix a missing toolchain rather than just failing', async () => {
    const { engine } = engineWith(() => ({ spawnFailed: true, code: null }));
    const health = await engine.health();
    expect(health.status).toBe('unavailable');
    if (health.status === 'unavailable') {
      expect(health.reason).toContain('not on PATH');
      expect(health.reason).toContain('elan');
    }
  });

  it('reports a non-zero exit from the probe', async () => {
    const { engine } = engineWith(() => ({ code: 1, stderr: 'no default toolchain' }));
    const health = await engine.health();
    expect(health.status).toBe('unavailable');
    if (health.status === 'unavailable') expect(health.reason).toContain('no default toolchain');
  });

  it('probes once and caches the verdict', async () => {
    const { engine, runner } = engineWith(() => ({ stdout: 'Lake version 5.0.0' }));
    await engine.health();
    await engine.health();
    expect(runner.calls.filter((c) => c.args.includes('--version'))).toHaveLength(1);
    engine.reprobe();
    await engine.health();
    expect(runner.calls.filter((c) => c.args.includes('--version'))).toHaveLength(2);
  });
});

describe('elaborate', () => {
  const readyProbe = (r: RunRequest): Partial<RunResult> =>
    r.args.includes('--version') ? { stdout: 'Lake version 5.0.0' } : {};

  it('runs lake env lean --json against the scratch file', async () => {
    const { engine, runner } = engineWith(readyProbe);
    await engine.elaborate(request);
    const call = runner.calls.find((c) => c.args.includes('--json'))!;
    expect(call.command).toBe('lake');
    expect(call.args).toEqual(['env', 'lean', '--json', '.conjecture/Scratch.lean']);
    expect(call.cwd).toBe('/proj');
    expect(writes.at(-1)?.contents).toContain('#print axioms tail_bound');
  });

  it('reports a skeleton with a hole as accepted but not proved', async () => {
    const { engine } = engineWith((r) => {
      if (r.args.includes('--version')) return { stdout: 'Lake version 5.0.0' };
      return {
        code: 0,
        stdout: [
          JSON.stringify({
            severity: 'warning',
            pos: { line: 3, column: 8 },
            data: "declaration uses 'sorry'",
          }),
          JSON.stringify({
            severity: 'information',
            data: "'tail_bound' depends on axioms: [propext, sorryAx]",
          }),
        ].join('\n'),
      };
    });

    const result = await engine.elaborate(request);
    if (isEngineError(result)) throw new Error(result.message);
    // Lean exited zero, so the file elaborated — and the axiom report is what
    // stops this being called a proof.
    expect(result.kernelAccepted).toBe(true);
    expect(result.axioms?.dependsOnSorry).toBe(true);
    expect(result.sorries).toHaveLength(1);
  });

  it('reports a clean proof with its axiom receipt', async () => {
    const { engine } = engineWith((r) => {
      if (r.args.includes('--version')) return { stdout: 'Lake version 5.0.0' };
      return {
        code: 0,
        stdout: JSON.stringify({
          severity: 'information',
          data: "'tail_bound' depends on axioms: [propext, Classical.choice, Quot.sound]",
        }),
      };
    });

    const result = await engine.elaborate({ ...request, source: 'theorem tail_bound : True := trivial' });
    if (isEngineError(result)) throw new Error(result.message);
    expect(result.kernelAccepted).toBe(true);
    expect(result.axioms?.standardOnly).toBe(true);
    expect(result.sorries).toEqual([]);
  });

  it('does not call an errored run accepted', async () => {
    const { engine } = engineWith((r) => {
      if (r.args.includes('--version')) return { stdout: 'Lake version 5.0.0' };
      return {
        code: 1,
        stdout: JSON.stringify({
          severity: 'error',
          pos: { line: 9, column: 2 },
          data: 'unsolved goals\nk : ℕ\n⊢ f (k + 1) ≤ 2 * (k + 1)',
        }),
      };
    });

    const result = await engine.elaborate(request);
    if (isEngineError(result)) throw new Error(result.message);
    expect(result.kernelAccepted).toBe(false);
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]!.goal).toBe('f (k + 1) ≤ 2 * (k + 1)');
  });

  it('does not call a timed-out run accepted, even on exit code 0', async () => {
    const { engine } = engineWith((r) => {
      if (r.args.includes('--version')) return { stdout: 'Lake version 5.0.0' };
      return { code: 0, timedOut: true, stdout: '' };
    });
    const result = await engine.elaborate(request);
    if (isEngineError(result)) throw new Error(result.message);
    expect(result.kernelAccepted).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('refuses to elaborate at all when the engine is not ready', async () => {
    const { engine, runner } = engineWith(() => ({ spawnFailed: true }));
    const result = await engine.elaborate(request);
    expect(isEngineError(result)).toBe(true);
    expect(runner.calls.some((c) => c.args.includes('--json'))).toBe(false);
  });

  it('keeps lake’s plain-text output alongside the parsed diagnostics', async () => {
    const { engine } = engineWith((r) => {
      if (r.args.includes('--version')) return { stdout: 'Lake version 5.0.0' };
      return { code: 0, stdout: 'info: building TailBounds\n' };
    });
    const result = await engine.elaborate(request);
    if (isEngineError(result)) throw new Error(result.message);
    expect(result.unparsed).toEqual(['info: building TailBounds']);
  });
});

describe('UnavailableLeanEngine', () => {
  it('refuses every request with the reason, so squares stay hollow', async () => {
    const engine = new UnavailableLeanEngine('No Lean toolchain on PATH.');
    expect((await engine.health()).status).toBe('unavailable');
    const result = await engine.elaborate();
    expect(result.message).toBe('No Lean toolchain on PATH.');
  });
});
