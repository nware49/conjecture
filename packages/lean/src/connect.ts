/**
 * Connecting a project — the first-run path.
 *
 * Nothing is provable until this succeeds, and the honest failure is far more
 * common than the success, so each step reports its own outcome rather than
 * collapsing into one green tick.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { EngineHealth, Pin } from '@conjecture/core';
import { ProcessLeanEngine, UnavailableLeanEngine } from './process-engine.js';
import type { LeanEngine } from './engine.js';
import { countSorries, pinFrom, probeProject, type ProjectProbe } from './toolchain.js';
import type { CommandRunner } from './runner.js';

export type StepState = 'ok' | 'partial' | 'failed' | 'skipped';

export interface ConnectStep {
  readonly label: string;
  readonly state: StepState;
  readonly detail: string;
}

export interface ConnectResult {
  readonly probe: ProjectProbe;
  readonly pin: Pin | null;
  readonly health: EngineHealth;
  readonly engine: LeanEngine;
  readonly steps: readonly ConnectStep[];
  /** `sorry`s already in the repository, surfaced as pre-existing gaps. */
  readonly inheritedSorries: number;
  readonly leanFiles: number;
  /** True when a claim in this project could actually be checked. */
  readonly ready: boolean;
}

export interface ConnectOptions {
  readonly root: string;
  readonly runner?: CommandRunner;
  readonly lakeCommand?: string;
  /** Cap on files walked while counting inherited holes. */
  readonly maxFilesScanned?: number;
}

const DEFAULT_MAX_FILES = 4000;
const SKIP_DIRS = new Set(['.git', '.lake', 'lake-packages', 'node_modules', '.conjecture']);
/** Build scripts happen to end in .lean. They are not proof source. */
const SKIP_FILES = new Set(['lakefile.lean']);

async function walkLeanFiles(
  root: string,
  limit: number,
): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const queue: string[] = [root];
  let truncated = false;

  while (queue.length > 0 && files.length < limit) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) queue.push(join(dir, entry.name));
      } else if (entry.name.endsWith('.lean') && !SKIP_FILES.has(entry.name)) {
        if (files.length >= limit) {
          truncated = true;
          break;
        }
        files.push(join(dir, entry.name));
      }
    }
  }

  return { files, truncated: truncated || queue.length > 0 };
}

export async function connectProject(options: ConnectOptions): Promise<ConnectResult> {
  const steps: ConnectStep[] = [];

  let rootExists = false;
  try {
    rootExists = (await stat(options.root)).isDirectory();
  } catch {
    rootExists = false;
  }

  if (!rootExists) {
    const engine = new UnavailableLeanEngine(`No directory at ${options.root}.`);
    return {
      probe: { root: options.root, toolchain: null, lakefile: null, manifest: null, problems: ['Directory not found.'] },
      pin: null,
      health: await engine.health(),
      engine,
      steps: [{ label: 'Project directory', state: 'failed', detail: `Nothing at ${options.root}.` }],
      inheritedSorries: 0,
      leanFiles: 0,
      ready: false,
    };
  }

  const probe = await probeProject(options.root);
  steps.push({
    label: 'Project layout',
    state: probe.lakefile === null ? 'failed' : 'ok',
    detail: probe.lakefile ?? 'no lakefile found at the root',
  });

  const pin = pinFrom(probe);
  steps.push({
    label: 'Toolchain',
    state: probe.toolchain === null ? 'failed' : 'ok',
    detail: probe.toolchain ?? 'lean-toolchain is missing, so nothing can be pinned',
  });
  steps.push({
    label: 'Dependency revisions',
    state: probe.manifest === null ? 'failed' : 'ok',
    detail:
      pin === null
        ? 'unresolved'
        : `${Object.keys(pin.dependencies).length} pinned${pin.mathlibRev ? `, Mathlib @ ${pin.mathlibRev.slice(0, 7)}` : ''}`,
  });

  const engine: LeanEngine =
    pin === null
      ? new UnavailableLeanEngine(
          probe.problems[0] ?? 'This directory is not a Lean project that can be pinned.',
        )
      : new ProcessLeanEngine({
          root: options.root,
          ...(options.runner ? { runner: options.runner } : {}),
          ...(options.lakeCommand ? { lakeCommand: options.lakeCommand } : {}),
        });

  const health = await engine.health();
  steps.push({
    label: 'Lean server',
    state: health.status === 'ready' ? 'ok' : 'failed',
    detail: health.status === 'unavailable' ? health.reason : health.detail,
  });

  const { files, truncated } = await walkLeanFiles(
    options.root,
    options.maxFilesScanned ?? DEFAULT_MAX_FILES,
  );
  let inheritedSorries = 0;
  for (const file of files) {
    try {
      inheritedSorries += countSorries(await readFile(file, 'utf8'));
    } catch {
      // An unreadable file is not a reason to abandon the connection; it is a
      // reason not to claim the count is complete.
    }
  }

  steps.push({
    label: 'Existing gaps',
    state: inheritedSorries === 0 ? 'ok' : 'partial',
    detail:
      inheritedSorries === 0
        ? `no sorry in ${files.length} Lean files`
        : `${inheritedSorries} sorry across ${files.length} Lean files${truncated ? ' (scan truncated)' : ''}`,
  });

  return {
    probe,
    pin,
    health,
    engine,
    steps,
    inheritedSorries,
    leanFiles: files.length,
    ready: health.status === 'ready' && pin !== null,
  };
}
