/**
 * The real bridge: `lake env lean --json` over a scratch file in the project.
 *
 * A pinned toolchain runs behind it, diagnostics come back as ranges, and every
 * range maps to exactly one row in the proof list. There is no separate error
 * console to reconcile because there is only one source of messages.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EngineHealth } from '@conjecture/core';
import { findAxiomReport } from './axioms.js';
import { findSorries, parseGoals, parseJsonOutput, type Diagnostic } from './diagnostics.js';
import {
  buildSource,
  unshiftDiagnostic,
  type ElaborateRequest,
  type ElaborationResult,
  type EngineError,
  type LeanEngine,
} from './engine.js';
import { ChildProcessRunner, type CommandRunner } from './runner.js';

export interface ProcessEngineOptions {
  readonly root: string;
  readonly runner?: CommandRunner;
  /** Overridden in tests; defaults to `lake`. */
  readonly lakeCommand?: string;
  /** Where scratch files go, relative to the root. */
  readonly scratchDir?: string;
  /** Timeout for the one-off version probe. */
  readonly probeTimeoutMs?: number;
  readonly writeFileImpl?: (path: string, contents: string) => Promise<void>;
}

const DEFAULT_SCRATCH = '.conjecture';

async function defaultWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}

export class ProcessLeanEngine implements LeanEngine {
  readonly kind = 'lean-process' as const;

  private readonly runner: CommandRunner;
  private readonly lake: string;
  private readonly scratchDir: string;
  private readonly probeTimeoutMs: number;
  private readonly write: (path: string, contents: string) => Promise<void>;
  private cachedHealth: EngineHealth | null = null;

  constructor(private readonly options: ProcessEngineOptions) {
    this.runner = options.runner ?? new ChildProcessRunner();
    this.lake = options.lakeCommand ?? 'lake';
    this.scratchDir = options.scratchDir ?? DEFAULT_SCRATCH;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 30_000;
    this.write = options.writeFileImpl ?? defaultWrite;
  }

  async health(): Promise<EngineHealth> {
    if (this.cachedHealth !== null) return this.cachedHealth;

    const result = await this.runner.run({
      command: this.lake,
      args: ['--version'],
      cwd: this.options.root,
      timeoutMs: this.probeTimeoutMs,
    });

    if (result.spawnFailed) {
      this.cachedHealth = {
        status: 'unavailable',
        kind: 'lean-process',
        reason: `\`${this.lake}\` is not on PATH. Install a Lean toolchain with elan, then reconnect the project.`,
      };
    } else if (result.timedOut) {
      this.cachedHealth = {
        status: 'unavailable',
        kind: 'lean-process',
        reason: `\`${this.lake} --version\` did not respond within ${this.probeTimeoutMs} ms.`,
      };
    } else if (result.code !== 0) {
      this.cachedHealth = {
        status: 'unavailable',
        kind: 'lean-process',
        reason: `\`${this.lake} --version\` exited ${result.code}. ${result.stderr.trim().slice(0, 200)}`,
      };
    } else {
      this.cachedHealth = {
        status: 'ready',
        kind: 'lean-process',
        detail: result.stdout.trim().split('\n')[0] ?? 'lake',
      };
    }

    return this.cachedHealth;
  }

  /** Forget a cached health verdict, e.g. after a toolchain install. */
  reprobe(): void {
    this.cachedHealth = null;
  }

  async elaborate(request: ElaborateRequest): Promise<ElaborationResult | EngineError> {
    const health = await this.health();
    if (health.status !== 'ready') {
      return {
        message: health.status === 'unavailable' ? health.reason : health.detail,
        detail: null,
      };
    }

    const { text, headerLines } = buildSource(request);
    const relative = join(this.scratchDir, request.relativePath);
    const absolute = join(this.options.root, relative);

    try {
      await this.write(absolute, text);
    } catch (error) {
      return {
        message: 'Could not write the scratch file into the project.',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const result = await this.runner.run({
      command: this.lake,
      args: ['env', 'lean', '--json', relative],
      cwd: this.options.root,
      timeoutMs: request.timeoutMs,
    });

    if (result.spawnFailed) {
      return { message: `\`${this.lake}\` disappeared from PATH mid-session.`, detail: result.stderr };
    }

    const { diagnostics: raw, unparsed } = parseJsonOutput(result.stdout);
    const diagnostics = raw.map((d) => unshiftDiagnostic(d, headerLines));

    const goals = diagnostics.flatMap((d) => parseGoals(d));
    const sorries = findSorries(request.source, diagnostics);
    const axioms =
      request.declaration === null ? null : findAxiomReport(diagnostics, request.declaration);

    const hasErrors = diagnostics.some((d) => d.severity === 'error');

    return {
      diagnostics,
      sorries,
      goals,
      axioms,
      // Exit code plus a clean diagnostic list. Whether this counts as *proved*
      // is decided in the domain, from the axiom report and the sorry count —
      // never here.
      kernelAccepted: result.code === 0 && !hasErrors && !result.timedOut,
      elapsedMs: result.elapsedMs,
      exitCode: result.code,
      timedOut: result.timedOut,
      unparsed,
      stderr: result.stderr,
    };
  }

  async dispose(): Promise<void> {
    // Nothing persistent to tear down: each elaboration is its own process.
  }
}

/**
 * The engine used when there is no Lean to talk to.
 *
 * It refuses every request with a reason rather than pretending. The product's
 * empty-state rule depends on this: the library still opens, claims can still
 * be stated, and every square stays hollow.
 */
export class UnavailableLeanEngine implements LeanEngine {
  readonly kind = 'unavailable' as const;

  constructor(private readonly reason: string) {}

  async health(): Promise<EngineHealth> {
    return { status: 'unavailable', kind: 'unavailable', reason: this.reason };
  }

  async elaborate(): Promise<EngineError> {
    return { message: this.reason, detail: null };
  }

  async dispose(): Promise<void> {
    // Nothing to dispose.
  }
}

/** All diagnostics for one source line, for the inline gutter. */
export function diagnosticsAtLine(
  diagnostics: readonly Diagnostic[],
  line: number,
): readonly Diagnostic[] {
  return diagnostics.filter((d) => d.range.start.line === line);
}
