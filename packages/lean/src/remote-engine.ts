/**
 * A Lean engine that talks to a server somewhere else.
 *
 * Same port as the local process engine, so nothing above it changes: the
 * domain still decides what counts as proved, and this only supplies evidence.
 *
 * One thing genuinely improves over the local adapter. Because this speaks LSP
 * rather than reading a batch compiler's output, it can ask for the goal at any
 * position — so every hole gets its goal state, not only the ones Lean happened
 * to report as `unsolved goals`.
 */

import type { AxiomReport, EngineHealth, Pin, SourcePos } from '@conjecture/core';
import { findAxiomReport } from './axioms.js';
import {
  findSorries,
  parseGoals,
  toDiagnostic,
  type Diagnostic,
  type GoalState,
  type LeanJsonMessage,
  type SorryHole,
} from './diagnostics.js';
import {
  buildSource,
  unshiftDiagnostic,
  type ElaborateRequest,
  type ElaborationResult,
  type EngineError,
  type LeanEngine,
} from './engine.js';
import { LspClient } from './lsp/client.js';
import { severityName } from './lsp/jsonrpc.js';
import { WebSocketTransport, type LspTransport } from './lsp/transport.js';

export interface RemoteEngineOptions {
  /**
   * Either a full WebSocket URL, or an http(s) base which is turned into
   * `ws(s)://host/websocket/<project>` — the layout lean4web serves.
   */
  readonly endpoint: string;
  readonly project?: string;
  /** Injected in tests. */
  readonly transportFactory?: (url: string) => LspTransport;
  readonly requestTimeoutMs?: number;
  readonly elaborationTimeoutMs?: number;
  readonly framing?: 'plain' | 'content-length';
}

const DEFAULT_PROJECT = 'mathlib';
const DOCUMENT_URI = 'file:///conjecture/Claim.lean';

/** LSP counts lines from 0; Lean's own messages and our domain count from 1. */
function toLspPosition(pos: SourcePos): { line: number; character: number } {
  return { line: Math.max(0, pos.line - 1), character: pos.column };
}

export function resolveEndpoint(endpoint: string, project = DEFAULT_PROJECT): string {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed;

  const scheme = trimmed.startsWith('https://') ? 'wss' : 'ws';
  const withoutScheme = trimmed.replace(/^https?:\/\//, '');
  return `${scheme}://${withoutScheme}/websocket/${project}`;
}

interface RemoteEnvironment {
  readonly leanVersion: string | null;
  readonly serverInfo: string;
}

export class RemoteLeanEngine implements LeanEngine {
  readonly kind = 'lean-remote' as const;

  private readonly url: string;
  private readonly project: string;
  private cachedHealth: EngineHealth | null = null;
  private cachedEnvironment: RemoteEnvironment | null = null;

  constructor(private readonly options: RemoteEngineOptions) {
    this.project = options.project ?? DEFAULT_PROJECT;
    this.url = resolveEndpoint(options.endpoint, this.project);
  }

  get endpointUrl(): string {
    return this.url;
  }

  private makeTransport(): LspTransport {
    if (this.options.transportFactory) return this.options.transportFactory(this.url);
    return new WebSocketTransport({
      url: this.url,
      ...(this.options.framing ? { framing: this.options.framing } : {}),
    });
  }

  /**
   * Open a connection, run the handshake, hand it to `body`, and always close.
   * A connection per operation, like the process engine spawns per check: it is
   * slower than holding one open and it cannot leak half-elaborated state.
   */
  private async withSession<T>(body: (client: LspClient) => Promise<T>): Promise<T> {
    const client = new LspClient(this.makeTransport(), {
      requestTimeoutMs: this.options.requestTimeoutMs ?? 60_000,
    });
    await client.start();

    try {
      const initialize = (await client.request<{
        serverInfo?: { name?: string; version?: string };
      }>('initialize', {
        processId: null,
        clientInfo: { name: 'conjecture', version: '1.0.0' },
        rootUri: null,
        capabilities: {
          textDocument: {
            publishDiagnostics: { relatedInformation: false },
            synchronization: { didSave: false, dynamicRegistration: false },
          },
          workspace: { workspaceFolders: false, configuration: false },
        },
      })) ?? {};

      client.notify('initialized', {});

      const name = initialize.serverInfo?.name ?? 'Lean';
      const version = initialize.serverInfo?.version;
      this.cachedEnvironment = {
        leanVersion: version ?? this.cachedEnvironment?.leanVersion ?? null,
        serverInfo: version ? `${name} ${version}` : name,
      };

      return await body(client);
    } finally {
      await client.stop();
    }
  }

  async health(): Promise<EngineHealth> {
    if (this.cachedHealth !== null) return this.cachedHealth;

    try {
      const environment = await this.withSession(async (client) => {
        // The handshake alone proves a socket. Elaborating a one-line file
        // proves the toolchain behind it actually answers.
        const version = await this.probeVersion(client);
        return version;
      });

      this.cachedHealth = {
        status: 'ready',
        kind: 'lean-remote',
        detail: environment.leanVersion
          ? `${environment.serverInfo} at ${this.url}`
          : `${environment.serverInfo} at ${this.url} (version not reported)`,
      };
    } catch (error) {
      // The transport already names the endpoint in most of its errors. Only
      // add it when it is missing, so the reason reads as one sentence.
      const detail = error instanceof Error ? error.message : String(error);
      this.cachedHealth = {
        status: 'unavailable',
        kind: 'lean-remote',
        reason: detail.includes(this.url)
          ? detail
          : `Could not reach a Lean server at ${this.url}. ${detail}`,
      };
    }

    return this.cachedHealth;
  }

  reprobe(): void {
    this.cachedHealth = null;
    this.cachedEnvironment = null;
  }

  /** Ask the server what Lean it is running, by elaborating a probe file. */
  private async probeVersion(client: LspClient): Promise<RemoteEnvironment> {
    const uri = 'file:///conjecture/Probe.lean';
    const diagnostics = await this.openAndCollect(client, uri, '#eval Lean.versionString', 20_000);

    for (const diagnostic of diagnostics) {
      const match = /"?([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?)"?/.exec(diagnostic.message);
      if (match && diagnostic.severity === 'information') {
        this.cachedEnvironment = {
          leanVersion: match[1]!,
          serverInfo: this.cachedEnvironment?.serverInfo ?? 'Lean',
        };
        break;
      }
    }

    return (
      this.cachedEnvironment ?? { leanVersion: null, serverInfo: 'Lean' }
    );
  }

  /**
   * The pin a remote result is recorded against.
   *
   * The endpoint is part of the pin. Two servers running the same Lean are not
   * interchangeable, and a receipt from one must not read as current under the
   * other.
   */
  async describePin(now: () => Date = () => new Date()): Promise<Pin | null> {
    const health = await this.health();
    if (health.status !== 'ready') return null;

    const version = this.cachedEnvironment?.leanVersion;
    return {
      toolchain: version ? `leanprover/lean4:v${version}` : `remote:${this.url}`,
      // Nothing in the protocol reports the library revision. Claiming one we
      // did not read would be worse than admitting we cannot see it.
      mathlibRev: null,
      dependencies: { 'remote-endpoint': this.url, project: this.project },
      capturedAt: now().toISOString(),
    };
  }

  /** True when the endpoint cannot tell us what library revision it runs. */
  get libraryRevisionUnknown(): boolean {
    return true;
  }

  async elaborate(request: ElaborateRequest): Promise<ElaborationResult | EngineError> {
    const startedAt = Date.now();
    const { text, headerLines } = buildSource(request);
    const timeoutMs = this.options.elaborationTimeoutMs ?? request.timeoutMs;

    try {
      return await this.withSession(async (client) => {
        const raw = await this.openAndCollect(client, DOCUMENT_URI, text, timeoutMs);
        const diagnostics = raw.map((d) => unshiftDiagnostic(d, headerLines));

        const sorries = findSorries(request.source, diagnostics);
        const goals = await this.collectGoals(client, sorries, headerLines, diagnostics);

        const axioms: AxiomReport | null =
          request.declaration === null ? null : findAxiomReport(diagnostics, request.declaration);

        const hasErrors = diagnostics.some((d) => d.severity === 'error');

        return {
          diagnostics,
          sorries,
          goals,
          axioms,
          kernelAccepted: !hasErrors,
          elapsedMs: Date.now() - startedAt,
          exitCode: null,
          timedOut: false,
          unparsed: [],
          stderr: '',
        };
      });
    } catch (error) {
      return {
        message: `The remote Lean endpoint did not complete the check. ${
          error instanceof Error ? error.message : String(error)
        }`,
        detail: this.url,
      };
    }
  }

  /**
   * Open a document and wait until Lean has finished with it.
   *
   * Completion is `$/lean/fileProgress` reporting nothing left to process.
   * Diagnostics alone are not a finish line: Lean publishes them repeatedly as
   * it works, and reading the first batch means reading a half-elaborated file.
   */
  private async openAndCollect(
    client: LspClient,
    uri: string,
    text: string,
    timeoutMs: number,
  ): Promise<Diagnostic[]> {
    let latest: Diagnostic[] = [];

    const offDiagnostics = client.on('textDocument/publishDiagnostics', (params) => {
      const payload = params as { uri?: string; diagnostics?: unknown[] };
      if (payload.uri !== uri) return;
      latest = (payload.diagnostics ?? []).map((entry) => fromLspDiagnostic(entry, uri));
    });

    const processed = client.waitFor(
      '$/lean/fileProgress',
      (params) => {
        const payload = params as {
          textDocument?: { uri?: string };
          processing?: unknown[];
        };
        if (payload.textDocument?.uri !== uri) return false;
        return (payload.processing ?? []).length === 0;
      },
      timeoutMs,
    );

    client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'lean4', version: 1, text },
    });

    try {
      await processed;
      // Diagnostics for the final state can land a tick after the progress
      // notification. Give them a moment rather than reporting a stale batch.
      await new Promise((resolve) => setTimeout(resolve, 60));
    } finally {
      offDiagnostics();
      client.notify('textDocument/didClose', { textDocument: { uri } });
    }

    return latest;
  }

  /**
   * Goals at every hole.
   *
   * The batch adapter can only report goals where Lean printed `unsolved
   * goals`. Here each `sorry` is asked about directly, which is the whole
   * reason to prefer a language server over a compiler run.
   */
  private async collectGoals(
    client: LspClient,
    sorries: readonly SorryHole[],
    headerLines: number,
    diagnostics: readonly Diagnostic[],
  ): Promise<GoalState[]> {
    const goals: GoalState[] = [];

    for (const hole of sorries) {
      const position = toLspPosition({
        line: hole.position.line + headerLines,
        column: hole.position.column,
      });

      try {
        const answer = await client.request<{ rendered?: string; goals?: string[] } | null>(
          '$/lean/plainGoal',
          { textDocument: { uri: DOCUMENT_URI }, position },
          15_000,
        );

        const rendered = answer?.rendered ?? answer?.goals?.join('\n\n');
        if (!rendered || rendered.trim().length === 0) continue;

        goals.push(parseRenderedGoal(rendered, hole.position));
      } catch {
        // A server that does not implement the Lean extensions is still usable
        // for checking. Fall through to whatever the diagnostics carried.
      }
    }

    if (goals.length === 0) {
      for (const diagnostic of diagnostics) goals.push(...parseGoals(diagnostic));
    }

    return goals;
  }

  async dispose(): Promise<void> {
    // Each operation opens and closes its own connection, so there is nothing
    // held open here. Clearing the cached probe means a later reconnect asks
    // the endpoint again rather than trusting what it said last time.
    this.reprobe();
  }
}

/** Turn an LSP diagnostic object into ours, reusing the classifier. */
function fromLspDiagnostic(entry: unknown, uri: string): Diagnostic {
  const value = entry as {
    range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } };
    severity?: number;
    message?: string;
  };

  // Our parser speaks Lean's batch JSON shape, so translate into that and let
  // one classifier handle both transports.
  const asBatch: LeanJsonMessage = {
    severity: severityName(value.severity),
    pos: {
      line: (value.range?.start?.line ?? 0) + 1,
      column: value.range?.start?.character ?? 0,
    },
    endPos: {
      line: (value.range?.end?.line ?? value.range?.start?.line ?? 0) + 1,
      column: value.range?.end?.character ?? value.range?.start?.character ?? 0,
    },
    data: value.message ?? '',
    fileName: uri,
  };

  return toDiagnostic(asBatch);
}

/** Split a rendered goal into hypotheses and goal, without touching the text. */
export function parseRenderedGoal(rendered: string, position: SourcePos): GoalState {
  const lines = rendered.split('\n').filter((line) => line.trim().length > 0);
  const turnstileAt = lines.findIndex((line) => line.trimStart().startsWith('⊢'));

  if (turnstileAt === -1) {
    return { hypotheses: [], goal: rendered.trim(), position, raw: rendered.trim() };
  }

  return {
    hypotheses: lines.slice(0, turnstileAt),
    goal: lines
      .slice(turnstileAt)
      .join('\n')
      .replace(/^\s*⊢\s*/, ''),
    position,
    raw: rendered.trim(),
  };
}
