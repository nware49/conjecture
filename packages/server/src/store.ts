/**
 * Persistence.
 *
 * A workspace is a small document, so it lives in one JSON file written
 * atomically. The interface is narrow enough that swapping in a database later
 * touches nothing above it.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Claim, Project } from '@conjecture/core';

export const STATE_VERSION = 1 as const;

export interface PersistedState {
  readonly version: typeof STATE_VERSION;
  readonly project: Project | null;
  readonly claims: readonly Claim[];
  readonly updatedAt: string;
}

export function emptyState(): PersistedState {
  return {
    version: STATE_VERSION,
    project: null,
    claims: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export interface Repository {
  load(): Promise<PersistedState>;
  save(state: PersistedState): Promise<void>;
}

export class InMemoryRepository implements Repository {
  private state: PersistedState;

  constructor(initial: PersistedState = emptyState()) {
    this.state = initial;
  }

  async load(): Promise<PersistedState> {
    return this.state;
  }

  async save(state: PersistedState): Promise<void> {
    this.state = state;
  }
}

export class JsonFileRepository implements Repository {
  constructor(private readonly file: string) {}

  static inDirectory(dir: string): JsonFileRepository {
    return new JsonFileRepository(join(dir, 'workspace.json'));
  }

  async load(): Promise<PersistedState> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch {
      return emptyState();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt file is not a reason to start over silently. Keep it, and
      // report the problem by refusing to pretend the workspace was empty.
      throw new Error(
        `The workspace file at ${this.file} could not be parsed. It has been left untouched; move it aside to start fresh.`,
      );
    }

    const state = parsed as Partial<PersistedState>;
    if (state.version !== STATE_VERSION) {
      throw new Error(
        `Workspace file at ${this.file} is version ${String(state.version)}; this build reads version ${STATE_VERSION}.`,
      );
    }

    return {
      version: STATE_VERSION,
      project: state.project ?? null,
      claims: state.claims ?? [],
      updatedAt: state.updatedAt ?? new Date().toISOString(),
    };
  }

  /**
   * Write to a sibling temp file and rename over the target. A crash mid-write
   * then leaves the previous workspace intact instead of half of a new one.
   */
  async save(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
    await rename(temp, this.file);
  }
}
