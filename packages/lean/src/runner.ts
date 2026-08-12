/**
 * Subprocess execution, behind an interface.
 *
 * The engine's logic — building the file, mapping positions, deciding whether
 * the kernel accepted — is worth testing on real Lean output without requiring
 * a 1.2 GB Mathlib cache to be present, so the process boundary is a port.
 */

import { spawn } from 'node:child_process';

export interface RunRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly timedOut: boolean;
  readonly spawnFailed: boolean;
  readonly elapsedMs: number;
}

export interface CommandRunner {
  run(request: RunRequest): Promise<RunResult>;
}

/** Cap on captured output, so a runaway build cannot exhaust memory. */
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export class ChildProcessRunner implements CommandRunner {
  async run(request: RunRequest): Promise<RunResult> {
    const startedAt = Date.now();

    return await new Promise<RunResult>((resolve) => {
      let settled = false;
      const finish = (result: Omit<RunResult, 'elapsedMs'>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ...result, elapsedMs: Date.now() - startedAt });
      };

      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env ? { ...process.env, ...request.env } : process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;

      const append = (into: 'out' | 'err', chunk: Buffer): void => {
        const text = chunk.toString('utf8');
        if (stdout.length + stderr.length + text.length > MAX_CAPTURE_BYTES) {
          truncated = true;
          return;
        }
        if (into === 'out') stdout += text;
        else stderr += text;
      };

      child.stdout?.on('data', (chunk: Buffer) => append('out', chunk));
      child.stderr?.on('data', (chunk: Buffer) => append('err', chunk));

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({
          stdout,
          stderr: truncated ? `${stderr}\n[output truncated]` : stderr,
          code: null,
          timedOut: true,
          spawnFailed: false,
        });
      }, request.timeoutMs);

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish({
          stdout,
          stderr: `${stderr}${error.message}`,
          code: null,
          timedOut: false,
          spawnFailed: error.code === 'ENOENT',
        });
      });

      child.on('close', (code) => {
        finish({
          stdout,
          stderr: truncated ? `${stderr}\n[output truncated]` : stderr,
          code,
          timedOut: false,
          spawnFailed: false,
        });
      });
    });
  }
}
