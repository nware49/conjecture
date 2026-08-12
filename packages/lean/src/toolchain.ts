/**
 * Reading the environment a project pins itself to.
 *
 * The toolchain is read from `lean-toolchain` and displayed, never picked by
 * the app. Guessing a version here would corrupt every downstream receipt.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pin } from '@conjecture/core';

export interface ManifestPackage {
  readonly name?: string;
  readonly rev?: string;
  readonly scope?: string;
  readonly url?: string;
}

export interface LakeManifest {
  readonly version?: unknown;
  readonly packages?: readonly ManifestPackage[];
  readonly packagesDir?: string;
}

export interface ProjectProbe {
  readonly root: string;
  readonly toolchain: string | null;
  readonly lakefile: 'lakefile.lean' | 'lakefile.toml' | null;
  readonly manifest: LakeManifest | null;
  /** Everything that stopped this being a usable project. */
  readonly problems: readonly string[];
}

async function readIfPresent(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function probeProject(root: string): Promise<ProjectProbe> {
  const problems: string[] = [];

  const toolchainRaw = await readIfPresent(join(root, 'lean-toolchain'));
  const toolchain = toolchainRaw?.trim() || null;
  if (toolchain === null) {
    problems.push(
      'No lean-toolchain file. Proofs cannot be pinned to an environment, so nothing here can be verified.',
    );
  }

  let lakefile: ProjectProbe['lakefile'] = null;
  if ((await readIfPresent(join(root, 'lakefile.lean'))) !== null) lakefile = 'lakefile.lean';
  else if ((await readIfPresent(join(root, 'lakefile.toml'))) !== null) lakefile = 'lakefile.toml';
  if (lakefile === null) problems.push('No lakefile.lean or lakefile.toml at the project root.');

  let manifest: LakeManifest | null = null;
  const manifestRaw = await readIfPresent(join(root, 'lake-manifest.json'));
  if (manifestRaw !== null) {
    try {
      manifest = JSON.parse(manifestRaw) as LakeManifest;
    } catch {
      problems.push('lake-manifest.json is present but could not be parsed.');
    }
  } else {
    problems.push('No lake-manifest.json. Dependency revisions are unknown, so nothing can pin.');
  }

  return { root, toolchain, lakefile, manifest, problems };
}

/**
 * Turn a probe into a Pin, or null when the project cannot be pinned.
 *
 * Returning null is the right answer far more often than inventing a default:
 * a receipt recorded against a guessed toolchain is worse than no receipt.
 */
export function pinFrom(probe: ProjectProbe, now: () => Date = () => new Date()): Pin | null {
  if (probe.toolchain === null) return null;

  const dependencies: Record<string, string> = {};
  for (const pkg of probe.manifest?.packages ?? []) {
    if (typeof pkg.name === 'string' && typeof pkg.rev === 'string') {
      dependencies[pkg.name] = pkg.rev;
    }
  }

  return {
    toolchain: probe.toolchain,
    mathlibRev: dependencies['mathlib'] ?? null,
    dependencies,
    capturedAt: now().toISOString(),
  };
}

/** "leanprover/lean4:v4.9.0" → "4.9.0", for display only. */
export function toolchainVersion(toolchain: string): string | null {
  const match = /:v?([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?)/.exec(toolchain);
  return match?.[1] ?? null;
}

/** Existing `sorry`s in the repository, so the app never inherits debt quietly. */
export function countSorries(source: string): number {
  let count = 0;
  for (const line of source.split('\n')) {
    const withoutComment = line.replace(/--.*$/, '');
    count += (withoutComment.match(/\bsorry\b/g) ?? []).length;
  }
  return count;
}
