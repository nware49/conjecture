/**
 * Running searches, with live progress.
 *
 * A search is long-lived relative to an HTTP request, so it gets an id, a
 * record, and an event stream. Subscribers can come and go; the search does not
 * care, and cancelling it is a first-class outcome rather than a dropped socket.
 */

import { randomUUID } from 'node:crypto';
import type { SearchId } from '@conjecture/core';
import { asSearchId } from '@conjecture/core';
import {
  describeOutcome,
  runSearch,
  spaceSize,
  type SearchOutcome,
  type SearchProgress,
  type SearchRequest,
} from '@conjecture/refute';

export type SearchStatus = 'running' | 'done' | 'cancelled' | 'failed';

export interface SearchRecord {
  readonly id: SearchId;
  readonly claimId: string | null;
  readonly request: SearchRequest;
  status: SearchStatus;
  progress: SearchProgress;
  outcome: SearchOutcome | null;
  readonly startedAt: string;
  finishedAt: string | null;
  readonly spaceSize: string;
}

type Listener = (event: string, data: unknown) => void;

export class SearchRunner {
  private readonly records = new Map<SearchId, SearchRecord>();
  private readonly controllers = new Map<SearchId, AbortController>();
  private readonly listeners = new Map<SearchId, Set<Listener>>();
  /** Newest first. Bounded so a long session does not grow without limit. */
  private readonly order: SearchId[] = [];

  constructor(private readonly historyLimit = 50) {}

  start(request: SearchRequest, claimId: string | null): SearchRecord {
    const id = asSearchId(randomUUID());
    const controller = new AbortController();

    const record: SearchRecord = {
      id,
      claimId,
      request,
      status: 'running',
      progress: { candidatesChecked: 0, elapsedMs: 0, fraction: 0 },
      outcome: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      spaceSize: spaceSize(request.variables).toString(),
    };

    this.records.set(id, record);
    this.controllers.set(id, controller);
    this.order.unshift(id);
    this.trim();

    void this.drive(record, controller);
    return record;
  }

  private async drive(record: SearchRecord, controller: AbortController): Promise<void> {
    try {
      const outcome = await runSearch(record.request, {
        signal: controller.signal,
        onProgress: (progress) => {
          record.progress = progress;
          this.emit(record.id, 'progress', progress);
        },
      });

      record.outcome = outcome;
      record.status = controller.signal.aborted ? 'cancelled' : outcome.kind === 'error' ? 'failed' : 'done';
      record.progress = {
        candidatesChecked: outcome.candidatesChecked,
        elapsedMs: outcome.elapsedMs,
        fraction: record.progress.fraction,
      };
    } catch (error) {
      record.status = 'failed';
      record.outcome = {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
        position: null,
        candidatesChecked: record.progress.candidatesChecked,
        elapsedMs: record.progress.elapsedMs,
      };
    } finally {
      record.finishedAt = new Date().toISOString();
      this.controllers.delete(record.id);
      this.emit(record.id, 'done', this.describe(record));
      this.closeAll(record.id);
    }
  }

  get(id: SearchId): SearchRecord | undefined {
    return this.records.get(id);
  }

  list(): readonly SearchRecord[] {
    return this.order.map((id) => this.records.get(id)!).filter(Boolean);
  }

  cancel(id: SearchId): boolean {
    const controller = this.controllers.get(id);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  subscribe(id: SearchId, listener: Listener): () => void {
    const set = this.listeners.get(id) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(id, set);

    // A subscriber that arrives after the search finished still deserves the
    // result, not an empty stream that never speaks.
    const record = this.records.get(id);
    if (record && record.status !== 'running') {
      queueMicrotask(() => listener('done', this.describe(record)));
    }

    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(id);
    };
  }

  /** The wire shape for a record, including the house-voice sentence. */
  describe(record: SearchRecord): Record<string, unknown> {
    const upperBound = record.request.variables[0]
      ? record.request.variables[0].to.toString()
      : undefined;
    return {
      id: record.id,
      claimId: record.claimId,
      status: record.status,
      progress: record.progress,
      spaceSize: record.spaceSize,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      outcome: record.outcome,
      sentence: record.outcome ? describeOutcome(record.outcome, upperBound) : 'Searching…',
      variables: record.request.variables.map((v) => ({
        name: v.name,
        from: v.from.toString(),
        to: v.to.toString(),
        step: (v.step ?? 1n).toString(),
      })),
      strategy: record.request.strategy,
      budgetMs: record.request.budgetMs,
      definitions: record.request.definitions,
      predicate: record.request.predicate,
    };
  }

  private emit(id: SearchId, event: string, data: unknown): void {
    for (const listener of this.listeners.get(id) ?? []) listener(event, data);
  }

  private closeAll(id: SearchId): void {
    this.listeners.delete(id);
  }

  private trim(): void {
    while (this.order.length > this.historyLimit) {
      const dropped = this.order.pop()!;
      if (this.controllers.get(dropped)) continue;
      this.records.delete(dropped);
      this.listeners.delete(dropped);
    }
  }

  /** Stop everything. Called on shutdown so no search outlives the process. */
  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }
}
