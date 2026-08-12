/**
 * The API client.
 *
 * Every shape here mirrors what the server derives. In particular `view` is
 * computed server-side by the domain, so the client renders a claim's state
 * rather than deciding it. That is deliberate: there is one place that knows
 * what "proved" means, and it is not in the browser.
 */

export type ClaimState = 'open' | 'in_progress' | 'proved' | 'refuted' | 'stale';
export type MarkState = 'open' | 'partial' | 'proved' | 'refuted' | 'stale';
export type SyncState = 'synced' | 'lean-behind' | 'prose-behind' | 'diverged';

export interface ClaimView {
  state: ClaimState;
  stateLabel: string;
  mark: MarkState;
  fill: number;
  summary: string;
  rung: number;
  rungLabel: string;
  rungDescription: string;
  method: 'lean-kernel' | 'exhaustion' | null;
  methodLabel: string | null;
  scope: string | null;
  sorryCount: number;
  gapCount: number;
  percent: number;
  verifiedSteps: number;
  totalSteps: number;
  staleness: { field: string; name: string; was: string; now: string }[];
  trustsCompiler: boolean;
  customAxioms: string[];
}

export interface Claim {
  id: string;
  title: string;
  declaration: string;
  statement: {
    prose: string;
    lean: string;
    assumptions: string[];
    sync: SyncState;
    syncMessage: string;
  };
  steps: {
    id: string;
    text: string;
    status: 'verified' | 'gap' | 'blocked' | 'pending';
    citations: { name: string; origin: string }[];
    elapsedMs: number | null;
  }[];
  gaps: { id: string; label: string; line: number; column: number; goal: string | null }[];
  view: ClaimView;
  receipt: {
    engine: string;
    method: string;
    scope: string | null;
    declaration: string;
    axioms: { axioms: { name: string; kind: string }[]; standardOnly: boolean; trustsCompiler: boolean };
    sorryCount: number;
    accepted: boolean;
    elapsedMs: number;
    verifiedAt: string;
  } | null;
  refutation: {
    witness: { assignment: Record<string, string>; evaluation: string };
    authority: 'computed' | 'kernel-confirmed';
    candidatesChecked: number;
    elapsedMs: number;
    foundAt: string;
  } | null;
  dependsOn: string[];
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EngineHealth =
  | { status: 'ready'; kind: string; detail: string }
  | { status: 'building'; kind: string; detail: string }
  | { status: 'unavailable'; kind: string; reason: string };

export interface Workspace {
  project: {
    id: string;
    name: string;
    root: string;
    pinLabel: string;
    inheritedSorries: number;
    limits: { maxHeartbeats: number; elaborationTimeoutMs: number };
  } | null;
  engine: EngineHealth;
  claims: Claim[];
  counts: {
    byState: Record<ClaimState, number>;
    total: number;
    totalSorries: number;
    provedFraction: number;
  };
  canVerify: boolean;
  blockedReason: string | null;
}

export interface TraceRow {
  assignment: Record<string, string>;
  values: Record<string, string>;
  holds: boolean;
}

export type SearchOutcome =
  | { kind: 'witness'; witness: { assignment: Record<string, string>; evaluation: string }; candidatesChecked: number; elapsedMs: number; trace: TraceRow[]; usedProbabilisticPrimality: boolean }
  | { kind: 'exhausted'; candidatesChecked: number; elapsedMs: number; trace: TraceRow[]; usedProbabilisticPrimality: boolean }
  | { kind: 'budget'; reason: 'time' | 'candidates'; candidatesChecked: number; elapsedMs: number; trace: TraceRow[]; usedProbabilisticPrimality: boolean }
  | { kind: 'error'; message: string; position: { line: number; column: number } | null; candidatesChecked: number; elapsedMs: number };

export interface SearchRecord {
  id: string;
  claimId: string | null;
  status: 'running' | 'done' | 'cancelled' | 'failed';
  progress: { candidatesChecked: number; elapsedMs: number; fraction: number | null };
  spaceSize: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: SearchOutcome | null;
  sentence: string;
  variables: { name: string; from: string; to: string; step: string }[];
  strategy: 'enumerate' | 'random';
  budgetMs: number;
  definitions: string;
  predicate: string;
}

export interface GraphNode {
  id: string;
  title: string;
  declaration: string;
  state: ClaimState;
  fill: number;
  layer: number;
  onCriticalPath: boolean;
  invalidated: boolean;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: { from: string; to: string; onCriticalPath: boolean; dead: boolean }[];
  goal: string | null;
  blockers: string[];
  cycles: string[][];
  layerCount: number;
}

export interface Example {
  id: string;
  title: string;
  prose: string;
  lean: string;
  note: string;
  expect: string;
  request: {
    definitions: string;
    predicate: string;
    variables: { name: string; from: string; to: string; step: string }[];
    strategy: string;
    budgetMs: number;
    maxCandidates: number;
    report: { label: string; expr: string }[];
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });

  const text = await response.text();
  const body: unknown = text.length > 0 ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = body as { error?: string; detail?: string };
    throw new ApiError(response.status, error.error ?? response.statusText, error.detail ?? null);
  }

  return body as T;
}

export const api = {
  workspace: (): Promise<Workspace> => request('/workspace'),
  examples: (): Promise<Example[]> => request('/examples'),

  createClaim: (input: { title: string; prose?: string; lean?: string }): Promise<Claim> =>
    request('/claims', { method: 'POST', body: JSON.stringify(input) }),

  updateClaim: (
    id: string,
    input: { title?: string; prose?: string; lean?: string; confirmSync?: boolean },
  ): Promise<Claim> => request(`/claims/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),

  deleteClaim: (id: string): Promise<unknown> => request(`/claims/${id}`, { method: 'DELETE' }),

  verify: (id: string): Promise<{ claim: Claim; diagnostics: unknown[]; error: string | null }> =>
    request(`/claims/${id}/verify`, { method: 'POST' }),

  weaken: (id: string): Promise<Claim> => request(`/claims/${id}/weaken`, { method: 'POST' }),

  startSearch: (id: string, body: unknown): Promise<SearchRecord> =>
    request(`/claims/${id}/search`, { method: 'POST', body: JSON.stringify(body) }),

  search: (id: string): Promise<SearchRecord> => request(`/searches/${id}`),
  searches: (): Promise<SearchRecord[]> => request('/searches'),
  cancelSearch: (id: string): Promise<unknown> => request(`/searches/${id}/cancel`, { method: 'POST' }),
  applySearch: (id: string): Promise<Claim> => request(`/searches/${id}/apply`, { method: 'POST' }),

  graph: (goal: string | null): Promise<DependencyGraph> =>
    request(`/graph${goal ? `?goal=${encodeURIComponent(goal)}` : ''}`),

  connect: (root: string): Promise<{ workspace: Workspace; steps: unknown }> =>
    request('/project/connect', { method: 'POST', body: JSON.stringify({ root }) }),

  disconnect: (): Promise<Workspace> => request('/project/disconnect', { method: 'POST' }),
};

/** Subscribe to a search's progress. Returns an unsubscribe function. */
export function watchSearch(
  id: string,
  handlers: { onProgress?: (record: SearchRecord['progress']) => void; onDone?: (record: SearchRecord) => void },
): () => void {
  const source = new EventSource(`/api/searches/${id}/events`);

  // A search that finished before the stream opened arrives as both a `status`
  // frame and a `done` frame. Report it once.
  let settled = false;
  const finish = (record: SearchRecord): void => {
    if (settled) return;
    settled = true;
    handlers.onDone?.(record);
    source.close();
  };

  source.addEventListener('progress', (event) => {
    if (settled) return;
    handlers.onProgress?.(JSON.parse((event as MessageEvent<string>).data));
  });
  source.addEventListener('status', (event) => {
    const record = JSON.parse((event as MessageEvent<string>).data) as SearchRecord;
    if (record.status !== 'running') finish(record);
  });
  source.addEventListener('done', (event) => {
    finish(JSON.parse((event as MessageEvent<string>).data) as SearchRecord);
  });
  source.onerror = () => source.close();

  return () => {
    settled = true;
    source.close();
  };
}
