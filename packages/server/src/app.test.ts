import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { SearchRunner } from './search-runner.js';
import { seedWorkspace } from './seed.js';
import { ConjectureService } from './service.js';
import { InMemoryRepository } from './store.js';

let server: Server;
let base: string;
let service: ConjectureService;
let runner: SearchRunner;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await api(path, init);
  return (await response.json()) as T;
}

beforeEach(async () => {
  service = await ConjectureService.open({ repository: new InMemoryRepository() });
  runner = new SearchRunner();
  server = createServer(createApp({ service, runner }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterEach(async () => {
  runner.cancelAll();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('health and workspace', () => {
  it('reports the engine as unavailable when there is no Lean, with a reason', async () => {
    const health = await json<{ status: string; engine: { status: string; reason: string } }>(
      '/api/health',
    );
    expect(health.status).toBe('ok');
    expect(health.engine.status).toBe('unavailable');
    expect(health.engine.reason).toContain('No Lean toolchain');
  });

  it('opens an empty workspace and says why nothing can be verified', async () => {
    const workspace = await json<{ canVerify: boolean; blockedReason: string; claims: unknown[] }>(
      '/api/workspace',
    );
    expect(workspace.canVerify).toBe(false);
    expect(workspace.blockedReason).toContain('No project connected');
    expect(workspace.claims).toEqual([]);
  });
});

describe('claims', () => {
  it('creates a claim with a Lean-legal declaration name', async () => {
    const claim = await json<{ declaration: string; view: { state: string } }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: '2-adic tail bound', prose: 'A claim.' }),
    });
    expect(claim.declaration).toBe('c_2_adic_tail_bound');
    expect(claim.view.state).toBe('open');
  });

  it('disambiguates a duplicate title rather than colliding', async () => {
    await api('/api/claims', { method: 'POST', body: JSON.stringify({ title: 'Tail bound' }) });
    const second = await json<{ declaration: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Tail bound' }),
    });
    expect(second.declaration).toBe('tail_bound_2');
  });

  it('counts holes straight out of the Lean source, before any toolchain exists', async () => {
    const claim = await json<{ view: { state: string; sorryCount: number } }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Half done',
        lean: 'theorem t : True ∧ True := ⟨sorry, sorry⟩',
      }),
    });
    expect(claim.view.sorryCount).toBe(2);
    expect(claim.view.state).toBe('in_progress');
  });

  it('flags the Lean as behind when only the prose is edited', async () => {
    const created = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'T', prose: 'first', lean: 'theorem t : True := trivial' }),
    });
    const updated = await json<{ statement: { sync: string; syncMessage: string } }>(
      `/api/claims/${created.id}`,
      { method: 'PATCH', body: JSON.stringify({ prose: 'second' }) },
    );
    expect(updated.statement.sync).toBe('lean-behind');
    expect(updated.statement.syncMessage).toContain('still states the old claim');
  });

  it('rejects a claim with no title', async () => {
    const response = await api('/api/claims', { method: 'POST', body: JSON.stringify({ title: '  ' }) });
    expect(response.status).toBe(400);
  });

  it('404s an unknown claim', async () => {
    expect((await api('/api/claims/nope')).status).toBe(404);
  });

  it('refuses to verify a claim with no Lean in it', async () => {
    const created = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Prose only', prose: 'Some claim.' }),
    });
    const response = await api(`/api/claims/${created.id}/verify`, { method: 'POST' });
    expect(response.status).toBe(400);
  });

  it('reports the engine reason when asked to verify with no toolchain', async () => {
    const created = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'T', lean: 'theorem t : True := trivial' }),
    });
    const result = await json<{ error: string; claim: { view: { state: string } } }>(
      `/api/claims/${created.id}/verify`,
      { method: 'POST' },
    );
    expect(result.error).toContain('No Lean toolchain');
    // The square stays hollow. That is the whole point of the empty state.
    expect(result.claim.view.state).toBe('open');
  });

  it('drops a receipt when the Lean text changes underneath it', async () => {
    const created = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'T', lean: 'theorem t : True := trivial' }),
    });
    await service.applySearchOutcome(
      created.id,
      { kind: 'exhausted', candidatesChecked: 10, elapsedMs: 5, trace: [], usedProbabilisticPrimality: false },
      { definitions: '', predicate: 'n >= 0', variables: [{ name: 'n', from: 0n, to: 9n }], strategy: 'enumerate', budgetMs: 1000, maxCandidates: 10 },
      null,
    );
    expect((await json<{ view: { state: string } }>(`/api/claims/${created.id}`)).view.state).toBe('proved');

    const edited = await json<{ view: { state: string } }>(`/api/claims/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ lean: 'theorem t : False := sorry' }),
    });
    expect(edited.view.state).not.toBe('proved');
  });
});

describe('search', () => {
  it('runs a real search and reports the witness', async () => {
    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Euler polynomial', prose: 'n² + n + 41 is always prime.' }),
    });

    const started = await json<{ id: string }>(`/api/claims/${claim.id}/search`, {
      method: 'POST',
      body: JSON.stringify({
        definitions: 'p(n) = n ^ 2 + n + 41',
        predicate: 'isPrime(p(n))',
        variables: [{ name: 'n', from: '0', to: '1000' }],
        budgetMs: 10_000,
        maxCandidates: 1000,
      }),
    });

    const finished = await waitForSearch(started.id);
    expect(finished.status).toBe('done');
    expect(finished.outcome.kind).toBe('witness');
    expect(finished.outcome.witness.assignment.n).toBe('40');

    const applied = await json<{ view: { state: string; summary: string } }>(
      `/api/searches/${started.id}/apply`,
      { method: 'POST' },
    );
    expect(applied.view.state).toBe('refuted');
    // The record says plainly that no kernel was involved.
    expect(applied.view.summary).toContain('search only');
  });

  it('proves a bounded claim by exhaustion and names the scope', async () => {
    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Squares are non-negative below 500' }),
    });
    const started = await json<{ id: string }>(`/api/claims/${claim.id}/search`, {
      method: 'POST',
      body: JSON.stringify({
        predicate: 'n * n >= 0',
        variables: [{ name: 'n', from: '0', to: '499' }],
        budgetMs: 5_000,
        maxCandidates: 500,
      }),
    });
    const finished = await waitForSearch(started.id);
    expect(finished.outcome.kind).toBe('exhausted');

    const applied = await json<{ view: { state: string; summary: string; method: string } }>(
      `/api/searches/${started.id}/apply`,
      { method: 'POST' },
    );
    expect(applied.view.state).toBe('proved');
    expect(applied.view.method).toBe('exhaustion');
    expect(applied.view.summary).toContain('n ∈ [0, 499]');
    expect(applied.view.summary).toContain('500 candidates');
  });

  it('leaves the claim open when the search runs out of budget', async () => {
    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Something large' }),
    });
    const started = await json<{ id: string }>(`/api/claims/${claim.id}/search`, {
      method: 'POST',
      body: JSON.stringify({
        predicate: 'n >= 0',
        variables: [{ name: 'n', from: '0', to: '100000000' }],
        budgetMs: 1_000,
        maxCandidates: 50,
      }),
    });
    const finished = await waitForSearch(started.id);
    expect(finished.outcome.kind).toBe('budget');
    expect(finished.sentence).toContain('stays open');

    const applied = await json<{ view: { state: string } }>(`/api/searches/${started.id}/apply`, {
      method: 'POST',
    });
    expect(applied.view.state).toBe('open');
  });

  it('streams progress and a final frame over SSE', async () => {
    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Streamed' }),
    });
    const started = await json<{ id: string }>(`/api/claims/${claim.id}/search`, {
      method: 'POST',
      body: JSON.stringify({
        predicate: 'n >= 0',
        variables: [{ name: 'n', from: '0', to: '2000' }],
        budgetMs: 5_000,
        maxCandidates: 2000,
      }),
    });

    const response = await api(`/api/searches/${started.id}/events`);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await readStreamUntil(response, 'event: done');
    expect(text).toContain('event: status');
    expect(text).toContain('event: done');
  });

  it('rejects a search with no variables', async () => {
    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'No space' }),
    });
    const response = await api(`/api/claims/${claim.id}/search`, {
      method: 'POST',
      body: JSON.stringify({ predicate: 'true', variables: [] }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects non-integer bounds rather than coercing them', async () => {
    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Bad bounds' }),
    });
    const response = await api(`/api/claims/${claim.id}/search`, {
      method: 'POST',
      body: JSON.stringify({
        predicate: 'n >= 0',
        variables: [{ name: 'n', from: '0', to: '1.5' }],
      }),
    });
    expect(response.status).toBe(400);
  });

  it('can cancel a running search', async () => {
    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Long' }),
    });
    const started = await json<{ id: string }>(`/api/claims/${claim.id}/search`, {
      method: 'POST',
      body: JSON.stringify({
        predicate: 'n >= 0',
        variables: [{ name: 'n', from: '0', to: '100000000' }],
        budgetMs: 60_000,
        maxCandidates: 50_000_000,
      }),
    });
    await api(`/api/searches/${started.id}/cancel`, { method: 'POST' });
    const finished = await waitForSearch(started.id);
    expect(finished.status).toBe('cancelled');
  });
});

describe('weakening a refuted claim', () => {
  it('creates the bounded claim and marks the original superseded, not deleted', async () => {
    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Euler polynomial', prose: 'n² + n + 41 is always prime.' }),
    });
    const started = await json<{ id: string }>(`/api/claims/${claim.id}/search`, {
      method: 'POST',
      body: JSON.stringify({
        definitions: 'p(n) = n ^ 2 + n + 41',
        predicate: 'isPrime(p(n))',
        variables: [{ name: 'n', from: '0', to: '100' }],
        budgetMs: 10_000,
        maxCandidates: 100,
      }),
    });
    await waitForSearch(started.id);
    await api(`/api/searches/${started.id}/apply`, { method: 'POST' });

    const weakened = await json<{ id: string; title: string; statement: { assumptions: string[] } }>(
      `/api/claims/${claim.id}/weaken`,
      { method: 'POST' },
    );
    expect(weakened.title).toContain('n ≤ 39');
    expect(weakened.statement.assumptions).toContain('n ≤ 39');

    const original = await json<{ supersededBy: string; view: { state: string } }>(
      `/api/claims/${claim.id}`,
    );
    expect(original.supersededBy).toBe(weakened.id);
    expect(original.view.state).toBe('refuted');
  });

  it('refuses to weaken a claim with no counterexample', async () => {
    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Unrefuted' }),
    });
    expect((await api(`/api/claims/${claim.id}/weaken`, { method: 'POST' })).status).toBe(400);
  });
});

describe('the graph endpoint', () => {
  it('returns nodes, edges and blockers for a goal', async () => {
    const base_ = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Base case' }),
    });
    const goal = await service.createClaim({ title: 'Goal', dependsOn: [base_.id] });

    const graph = await json<{ nodes: unknown[]; edges: unknown[]; blockers: string[] }>(
      `/api/graph?goal=${goal.id}`,
    );
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.blockers).toContain(goal.id);
  });
});

describe('errors and routing', () => {
  it('405s a known path with the wrong method', async () => {
    expect((await api('/api/workspace', { method: 'DELETE' })).status).toBe(405);
  });

  it('rejects a malformed JSON body with 400', async () => {
    const response = await fetch(`${base}/api/claims`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(response.status).toBe(400);
  });

  it('404s an unknown API path when no client is being served', async () => {
    expect((await api('/api/nothing-here')).status).toBe(404);
  });

  it('serialises bigints as exact strings, never as floats', async () => {
    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Huge space' }),
    });
    const started = await json<{ spaceSize: string }>(`/api/claims/${claim.id}/search`, {
      method: 'POST',
      body: JSON.stringify({
        predicate: 'n >= 0',
        variables: [{ name: 'n', from: '1', to: '1000000000000000000000000' }],
        budgetMs: 1_000,
        maxCandidates: 5,
      }),
    });
    expect(started.spaceSize).toBe('1000000000000000000000000');
  });
});

describe('seeding', () => {
  it('produces a library of real results, with no invented proofs', async () => {
    await seedWorkspace(service, runner);
    const workspace = await json<{
      claims: { title: string; view: { state: string; method: string | null } }[];
    }>('/api/workspace');

    const byTitle = new Map(workspace.claims.map((c) => [c.title, c.view]));
    expect(byTitle.get('Euler’s prime-generating polynomial')?.state).toBe('refuted');
    expect(byTitle.get('Mersenne numbers at prime exponents')?.state).toBe('refuted');
    expect(byTitle.get('Collatz reaches 1 below 100,000')?.state).toBe('proved');
    expect(byTitle.get('Collatz reaches 1 below 100,000')?.method).toBe('exhaustion');
    // Pólya's counterexample is at 906 million, so the search finds nothing and
    // changes nothing. The claim keeps the state its own source earns it: a
    // stated skeleton with one hole in it.
    expect(byTitle.get('The Pólya conjecture')?.state).toBe('in_progress');
    expect(byTitle.get('The Pólya conjecture')?.method).toBeNull();
    // Likewise the tail bound, whose hole is read straight out of the text.
    expect(byTitle.get('Tail bound for f')?.state).toBe('in_progress');

    // Nothing claims a kernel check, because no kernel ran.
    for (const claim of workspace.claims) {
      expect(claim.view.method).not.toBe('lean-kernel');
    }
  }, 60_000);

  it('does not seed twice over an existing library', async () => {
    await service.createClaim({ title: 'Mine' });
    await seedWorkspace(service, runner, { runSearches: false });
    expect(service.claims).toHaveLength(1);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────

async function waitForSearch(id: string): Promise<{
  status: string;
  sentence: string;
  outcome: { kind: string; witness: { assignment: Record<string, string> } };
}> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const record = await json<{ status: string; sentence: string; outcome: never }>(
      `/api/searches/${id}`,
    );
    if (record.status !== 'running') return record;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('search did not finish in time');
}

async function readStreamUntil(response: Response, marker: string): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (value) text += decoder.decode(value, { stream: true });
    if (text.includes(marker) || done) break;
  }
  await reader.cancel().catch(() => undefined);
  return text;
}
