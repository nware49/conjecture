/**
 * The remote-endpoint path, end to end through the API.
 *
 * A scripted Lean server stands in for a real one, so this covers the wiring —
 * connect, pin, receipt provenance, the caveat — without a network.
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JsonRpcMessage, LspTransport } from '@conjecture/lean';
import { createApp } from './app.js';
import { SearchRunner } from './search-runner.js';
import { ConjectureService } from './service.js';
import { InMemoryRepository } from './store.js';

class ScriptedLean implements LspTransport {
  private handler: ((message: JsonRpcMessage) => void) | null = null;

  constructor(
    private readonly script: {
      version?: string;
      diagnostics?: (text: string) => unknown[];
    } = {},
  ) {}

  async open(): Promise<void> {}
  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.handler = handler;
  }
  onClose(): void {}
  async close(): Promise<void> {}

  send(message: JsonRpcMessage): void {
    queueMicrotask(() => {
      if (!('method' in message)) return;

      if (message.method === 'initialize' && 'id' in message) {
        this.handler?.({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            capabilities: {},
            serverInfo: { name: 'Lean 4', version: this.script.version ?? '4.9.0' },
          },
        });
        return;
      }

      if (message.method === 'textDocument/didOpen') {
        const { uri, text } = (message.params as { textDocument: { uri: string; text: string } })
          .textDocument;
        this.handler?.({
          jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics',
          params: { uri, diagnostics: this.script.diagnostics?.(text) ?? [] },
        });
        this.handler?.({
          jsonrpc: '2.0',
          method: '$/lean/fileProgress',
          params: { textDocument: { uri }, processing: [] },
        });
        return;
      }

      if (message.method === '$/lean/plainGoal' && 'id' in message) {
        this.handler?.({ jsonrpc: '2.0', id: message.id, result: null });
      }
    });
  }
}

const info = (message: string): unknown => ({
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  severity: 3,
  message,
});

let server: Server;
let base: string;
let runner: SearchRunner;

async function boot(script: ConstructorParameters<typeof ScriptedLean>[0]): Promise<void> {
  const service = await ConjectureService.open({
    repository: new InMemoryRepository(),
    remoteTransport: () => new ScriptedLean(script),
  });
  runner = new SearchRunner();
  server = createServer(createApp({ service, runner }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  return (await response.json()) as T;
}

afterEach(async () => {
  runner?.cancelAll();
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe('connecting a Lean server that lives elsewhere', () => {
  beforeEach(async () => {
    await boot({
      version: '4.9.0',
      diagnostics: (text) => (text.includes('versionString') ? [info('"4.9.0"')] : []),
    });
  });

  it('connects by URL with no directory and no local install', async () => {
    const result = await json<{
      project: { pin: { toolchain: string }; source: { kind: string; endpoint: string } };
      workspace: { canVerify: boolean; engine: { status: string; kind: string } };
    }>('/api/project/connect', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'https://lean.example.org' }),
    });

    expect(result.workspace.engine.status).toBe('ready');
    expect(result.workspace.engine.kind).toBe('lean-remote');
    expect(result.workspace.canVerify).toBe(true);
    expect(result.project.source.kind).toBe('remote');
    expect(result.project.source.endpoint).toBe('wss://lean.example.org/websocket/mathlib');
    expect(result.project.pin.toolchain).toBe('leanprover/lean4:v4.9.0');
  });

  it('says out loud that a remote pin cannot see the library revision', async () => {
    await json('/api/project/connect', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'https://lean.example.org' }),
    });

    const workspace = await json<{ pinCaveat: string | null }>('/api/workspace');
    expect(workspace.pinCaveat).toContain('does not report the library revision');
    expect(workspace.pinCaveat).toContain('cannot be detected');
  });

  it('reports the library-revision limit as a connection step, not a silent gap', async () => {
    const result = await json<{ steps: { label: string; state: string; detail: string }[] }>(
      '/api/project/connect',
      { method: 'POST', body: JSON.stringify({ endpoint: 'https://lean.example.org' }) },
    );
    const step = result.steps.find((s) => s.label === 'Library revision')!;
    expect(step.state).toBe('partial');
    expect(step.detail).toContain('staleness');
  });

  it('rejects a connect request naming neither a directory nor an endpoint', async () => {
    const response = await fetch(`${base}/api/project/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });
});

describe('receipts from a remote endpoint', () => {
  it('records which engine decided it, and stays hollow when the file has a hole', async () => {
    await boot({
      diagnostics: (text) =>
        text.includes('sorry')
          ? [
              {
                range: { start: { line: 3, character: 2 }, end: { line: 3, character: 7 } },
                severity: 2,
                message: "declaration uses 'sorry'",
              },
              info("'holed' depends on axioms: [propext, sorryAx]"),
            ]
          : [info('"4.9.0"')],
    });

    await json('/api/project/connect', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'https://lean.example.org' }),
    });

    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Holed', lean: 'theorem holed : True := by\n  sorry' }),
    });

    const verified = await json<{
      claim: { view: { state: string; rung: number }; receipt: { engine: string } | null };
      error: string | null;
    }>(`/api/claims/${claim.id}/verify`, { method: 'POST' });

    expect(verified.error).toBeNull();
    expect(verified.claim.receipt?.engine).toBe('lean-remote');
    // The axiom report reaches sorryAx, so it is not proved however clean the
    // elaboration looked.
    expect(verified.claim.view.state).not.toBe('proved');
    expect(verified.claim.view.rung).toBe(3);
  });

  it('proves a clean theorem and records the standard axioms', async () => {
    await boot({
      diagnostics: (text) =>
        text.includes('versionString')
          ? [info('"4.9.0"')]
          : [info("'clean' depends on axioms: [propext, Classical.choice, Quot.sound]")],
    });

    await json('/api/project/connect', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'https://lean.example.org' }),
    });

    const claim = await json<{ id: string }>('/api/claims', {
      method: 'POST',
      body: JSON.stringify({ title: 'Clean', lean: 'theorem clean : True := trivial' }),
    });

    const verified = await json<{ claim: { view: { state: string; rung: number } } }>(
      `/api/claims/${claim.id}/verify`,
      { method: 'POST' },
    );

    expect(verified.claim.view.state).toBe('proved');
    expect(verified.claim.view.rung).toBe(5);
  });
});

describe('an endpoint that is not there', () => {
  it('reports why, and leaves every square hollow', async () => {
    const service = await ConjectureService.open({
      repository: new InMemoryRepository(),
      remoteTransport: () => ({
        open: () => Promise.reject(new Error('ECONNREFUSED')),
        send: () => undefined,
        onMessage: () => undefined,
        onClose: () => undefined,
        close: () => Promise.resolve(),
      }),
    });
    runner = new SearchRunner();
    server = createServer(createApp({ service, runner }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    const result = await json<{
      project: unknown;
      workspace: { canVerify: boolean; blockedReason: string };
    }>('/api/project/connect', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'https://down.example.org' }),
    });

    expect(result.project).toBeNull();
    expect(result.workspace.canVerify).toBe(false);
    expect(result.workspace.blockedReason).toContain('down.example.org');
  });
});
