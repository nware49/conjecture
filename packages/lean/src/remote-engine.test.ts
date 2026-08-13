import { describe, expect, it } from 'vitest';
import { isEngineError, type ElaborateRequest } from './engine.js';
import { decodeFrame, encodeFrame } from './lsp/jsonrpc.js';
import type { JsonRpcMessage } from './lsp/jsonrpc.js';
import type { LspTransport } from './lsp/transport.js';
import { parseRenderedGoal, RemoteLeanEngine, resolveEndpoint } from './remote-engine.js';

/**
 * A scripted Lean server.
 *
 * Answers the handshake, then replays whatever the test says the server sends
 * back for a given document. This is the closest thing to a real endpoint that
 * a machine with no Lean on it can offer, and it exercises every line of the
 * client except the socket itself.
 */
class FakeLeanServer implements LspTransport {
  readonly sent: JsonRpcMessage[] = [];
  private messageHandler: ((message: JsonRpcMessage) => void) | null = null;
  private closeHandler: ((reason: string) => void) | null = null;
  private opened = false;

  constructor(
    private readonly script: {
      serverInfo?: { name: string; version: string };
      /** Diagnostics keyed by the text the client opens. */
      diagnosticsFor?: (text: string, uri: string) => unknown[];
      plainGoal?: string | null;
      /** Never report the file as finished, to exercise the timeout. */
      neverFinish?: boolean;
      /** Drop the connection after the handshake. */
      dropAfterHandshake?: boolean;
      /** Reject $/lean/plainGoal, as a server without the Lean extensions would. */
      noLeanExtensions?: boolean;
    } = {},
  ) {}

  async open(): Promise<void> {
    this.opened = true;
  }

  send(message: JsonRpcMessage): void {
    if (!this.opened) throw new Error('not open');
    this.sent.push(message);
    queueMicrotask(() => this.respond(message));
  }

  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (reason: string) => void): void {
    this.closeHandler = handler;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  private emit(message: JsonRpcMessage): void {
    // Round-trip through the codec so the framing is covered too.
    const decoded = decodeFrame(encodeFrame(message, 'plain'));
    if (decoded) this.messageHandler?.(decoded);
  }

  private respond(message: JsonRpcMessage): void {
    if (!('method' in message)) return;

    if (message.method === 'initialize' && 'id' in message) {
      this.emit({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {},
          serverInfo: this.script.serverInfo ?? { name: 'Lean 4', version: '4.9.0' },
        },
      });
      if (this.script.dropAfterHandshake) {
        queueMicrotask(() => this.closeHandler?.('server went away'));
      }
      return;
    }

    if (message.method === 'textDocument/didOpen') {
      const params = message.params as { textDocument: { uri: string; text: string } };
      const { uri, text } = params.textDocument;

      const diagnostics = this.script.diagnosticsFor?.(text, uri) ?? [];
      this.emit({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } });

      if (this.script.neverFinish) return;
      // Lean reports work in progress, then an empty list when it is done.
      this.emit({
        jsonrpc: '2.0',
        method: '$/lean/fileProgress',
        params: { textDocument: { uri, version: 1 }, processing: [{ range: {}, kind: 1 }] },
      });
      this.emit({
        jsonrpc: '2.0',
        method: '$/lean/fileProgress',
        params: { textDocument: { uri, version: 1 }, processing: [] },
      });
      return;
    }

    if (message.method === '$/lean/plainGoal' && 'id' in message) {
      if (this.script.noLeanExtensions) {
        this.emit({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'method not found' },
        });
        return;
      }
      this.emit({
        jsonrpc: '2.0',
        id: message.id,
        result: this.script.plainGoal === null ? null : { rendered: this.script.plainGoal ?? '' },
      });
    }
  }
}

const request: ElaborateRequest = {
  relativePath: 'Claim.lean',
  source: 'theorem tail_bound (n : ℕ) : f n ≤ 2 * n := by\n  sorry',
  declaration: 'tail_bound',
  maxHeartbeats: 200_000,
  timeoutMs: 5_000,
};

function lspDiagnostic(line: number, severity: number, message: string): unknown {
  return {
    range: { start: { line, character: 2 }, end: { line, character: 7 } },
    severity,
    message,
  };
}

describe('resolveEndpoint', () => {
  it('turns an https base into the websocket path lean4web serves', () => {
    expect(resolveEndpoint('https://lean.example.org')).toBe('wss://lean.example.org/websocket/mathlib');
  });

  it('keeps ws over plain http for a local container', () => {
    expect(resolveEndpoint('http://localhost:8080', 'mathlib')).toBe(
      'ws://localhost:8080/websocket/mathlib',
    );
  });

  it('leaves an explicit websocket URL alone', () => {
    expect(resolveEndpoint('wss://host/websocket/custom')).toBe('wss://host/websocket/custom');
  });

  it('honours a named project and tolerates a trailing slash', () => {
    expect(resolveEndpoint('https://host/', 'stdlib')).toBe('wss://host/websocket/stdlib');
  });
});

describe('health', () => {
  it('reports ready and names the server and endpoint', async () => {
    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      transportFactory: () =>
        new FakeLeanServer({
          serverInfo: { name: 'Lean 4', version: '4.9.0' },
          diagnosticsFor: () => [lspDiagnostic(0, 3, '"4.9.0"')],
        }),
    });

    const health = await engine.health();
    expect(health.status).toBe('ready');
    expect(health.kind).toBe('lean-remote');
    if (health.status === 'ready') {
      expect(health.detail).toContain('wss://lean.example.org/websocket/mathlib');
    }
  });

  it('reports unavailable with the endpoint when the socket will not open', async () => {
    const engine = new RemoteLeanEngine({
      endpoint: 'https://down.example.org',
      transportFactory: () => ({
        open: () => Promise.reject(new Error('ECONNREFUSED')),
        send: () => undefined,
        onMessage: () => undefined,
        onClose: () => undefined,
        close: () => Promise.resolve(),
      }),
    });

    const health = await engine.health();
    expect(health.status).toBe('unavailable');
    if (health.status === 'unavailable') {
      expect(health.reason).toContain('down.example.org');
      expect(health.reason).toContain('ECONNREFUSED');
    }
  });

  it('caches the verdict and reprobes on request', async () => {
    let connections = 0;
    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      transportFactory: () => {
        connections += 1;
        return new FakeLeanServer({ diagnosticsFor: () => [] });
      },
    });

    await engine.health();
    await engine.health();
    expect(connections).toBe(1);
    engine.reprobe();
    await engine.health();
    expect(connections).toBe(2);
  });
});

describe('elaborate', () => {
  it('collects diagnostics and finds the hole', async () => {
    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      transportFactory: () =>
        new FakeLeanServer({
          diagnosticsFor: (text) =>
            text.includes('sorry') ? [lspDiagnostic(3, 2, "declaration uses 'sorry'")] : [],
          plainGoal: 'k : ℕ\nih : f k ≤ 2 * k\n⊢ f (k + 1) ≤ 2 * (k + 1)',
        }),
    });

    const result = await engine.elaborate(request);
    if (isEngineError(result)) throw new Error(result.message);

    expect(result.sorries).toHaveLength(1);
    expect(result.diagnostics[0]!.condition).toBe('sorry');
    // No error diagnostics, so the file elaborated. Whether that is a proof is
    // decided elsewhere, from the hole count and the axioms.
    expect(result.kernelAccepted).toBe(true);
  });

  it('asks for the goal at each hole rather than waiting for unsolved goals', async () => {
    const fake = new FakeLeanServer({
      diagnosticsFor: () => [lspDiagnostic(3, 2, "declaration uses 'sorry'")],
      plainGoal: 'k : ℕ\nih : f k ≤ 2 * k\n⊢ f (k + 1) ≤ 2 * (k + 1)',
    });

    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      transportFactory: () => fake,
    });

    const result = await engine.elaborate(request);
    if (isEngineError(result)) throw new Error(result.message);

    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]!.hypotheses).toEqual(['k : ℕ', 'ih : f k ≤ 2 * k']);
    expect(result.goals[0]!.goal).toBe('f (k + 1) ≤ 2 * (k + 1)');

    const asked = fake.sent.filter((m) => 'method' in m && m.method === '$/lean/plainGoal');
    expect(asked).toHaveLength(1);
  });

  it('shifts the goal request past the options header it prepends', async () => {
    const fake = new FakeLeanServer({
      diagnosticsFor: () => [],
      plainGoal: '⊢ True',
    });
    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      transportFactory: () => fake,
    });

    await engine.elaborate(request);
    const ask = fake.sent.find((m) => 'method' in m && m.method === '$/lean/plainGoal');
    const params = (ask as { params: { position: { line: number } } }).params;
    // `sorry` sits on source line 2 (1-based). Two header lines are prepended,
    // and LSP counts from zero, so the wire position is line 3.
    expect(params.position.line).toBe(3);
  });

  it('falls back to unsolved-goals text when the server lacks the Lean extensions', async () => {
    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      transportFactory: () =>
        new FakeLeanServer({
          noLeanExtensions: true,
          diagnosticsFor: () => [
            lspDiagnostic(8, 1, 'unsolved goals\nk : ℕ\n⊢ f (k + 1) ≤ 2 * (k + 1)'),
          ],
        }),
    });

    const result = await engine.elaborate(request);
    if (isEngineError(result)) throw new Error(result.message);
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]!.goal).toBe('f (k + 1) ≤ 2 * (k + 1)');
  });

  it('reads the axiom report out of an information diagnostic', async () => {
    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      transportFactory: () =>
        new FakeLeanServer({
          diagnosticsFor: () => [
            lspDiagnostic(10, 3, "'tail_bound' depends on axioms: [propext, Classical.choice, Quot.sound]"),
          ],
        }),
    });

    const result = await engine.elaborate({ ...request, source: 'theorem tail_bound : True := trivial' });
    if (isEngineError(result)) throw new Error(result.message);
    expect(result.axioms?.standardOnly).toBe(true);
  });

  it('does not call an errored file accepted', async () => {
    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      transportFactory: () =>
        new FakeLeanServer({
          diagnosticsFor: () => [lspDiagnostic(4, 1, "unknown identifier 'nope'")],
        }),
    });

    const result = await engine.elaborate(request);
    if (isEngineError(result)) throw new Error(result.message);
    expect(result.kernelAccepted).toBe(false);
    expect(result.diagnostics[0]!.condition).toBe('unknown-identifier');
  });

  it('reports an engine error, not a result, when the file never finishes', async () => {
    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      elaborationTimeoutMs: 120,
      transportFactory: () => new FakeLeanServer({ neverFinish: true }),
    });

    const result = await engine.elaborate(request);
    expect(isEngineError(result)).toBe(true);
    if (isEngineError(result)) expect(result.message).toContain('did not complete');
  });

  it('reports the endpoint dropping mid-request rather than hanging', async () => {
    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      elaborationTimeoutMs: 500,
      transportFactory: () => new FakeLeanServer({ dropAfterHandshake: true, neverFinish: true }),
    });

    const result = await engine.elaborate(request);
    expect(isEngineError(result)).toBe(true);
  });
});

describe('the remote pin', () => {
  it('records the Lean version and the endpoint, and admits it cannot see the library', async () => {
    const engine = new RemoteLeanEngine({
      endpoint: 'https://lean.example.org',
      transportFactory: () =>
        new FakeLeanServer({
          serverInfo: { name: 'Lean 4', version: '4.9.0' },
          diagnosticsFor: () => [lspDiagnostic(0, 3, '"4.9.0"')],
        }),
    });

    const pin = await engine.describePin(() => new Date(0));
    expect(pin).not.toBeNull();
    expect(pin!.toolchain).toBe('leanprover/lean4:v4.9.0');
    // Nothing in the protocol reports it, so it is null rather than invented.
    expect(pin!.mathlibRev).toBeNull();
    expect(pin!.dependencies['remote-endpoint']).toBe('wss://lean.example.org/websocket/mathlib');
    expect(engine.libraryRevisionUnknown).toBe(true);
  });

  it('makes two different endpoints two different pins', async () => {
    const make = (host: string): RemoteLeanEngine =>
      new RemoteLeanEngine({
        endpoint: host,
        transportFactory: () =>
          new FakeLeanServer({ diagnosticsFor: () => [lspDiagnostic(0, 3, '"4.9.0"')] }),
      });

    const a = await make('https://one.example.org').describePin(() => new Date(0));
    const b = await make('https://two.example.org').describePin(() => new Date(0));
    // Same Lean, different servers. A receipt from one must not read as current
    // under the other.
    expect(a!.dependencies['remote-endpoint']).not.toBe(b!.dependencies['remote-endpoint']);
  });

  it('has no pin when the endpoint is unreachable', async () => {
    const engine = new RemoteLeanEngine({
      endpoint: 'https://down.example.org',
      transportFactory: () => ({
        open: () => Promise.reject(new Error('refused')),
        send: () => undefined,
        onMessage: () => undefined,
        onClose: () => undefined,
        close: () => Promise.resolve(),
      }),
    });
    expect(await engine.describePin()).toBeNull();
  });
});

describe('parseRenderedGoal', () => {
  it('splits hypotheses from the goal', () => {
    const goal = parseRenderedGoal('n : ℕ\nh : 0 < n\n⊢ n ≠ 0', { line: 3, column: 2 });
    expect(goal.hypotheses).toEqual(['n : ℕ', 'h : 0 < n']);
    expect(goal.goal).toBe('n ≠ 0');
  });

  it('keeps text with no turnstile verbatim rather than guessing', () => {
    const goal = parseRenderedGoal('no goals', { line: 1, column: 0 });
    expect(goal.hypotheses).toEqual([]);
    expect(goal.goal).toBe('no goals');
  });
});
