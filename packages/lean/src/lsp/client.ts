/**
 * A minimal LSP client.
 *
 * Enough of the protocol to open a document, wait for Lean to finish thinking
 * about it, and read back what it said. Requests time out rather than hanging,
 * because a silent Lean server and a working one look identical from here.
 */

import {
  isNotification,
  isResponse,
  type JsonRpcMessage,
  type JsonRpcResponse,
} from './jsonrpc.js';
import type { LspTransport } from './transport.js';

export interface LspClientOptions {
  readonly requestTimeoutMs?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

export class LspError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = 'LspError';
  }
}

export class LspClient {
  private nextId = 1;
  private readonly pending = new Map<number | string, Pending>();
  private readonly notificationHandlers = new Map<string, ((params: unknown) => void)[]>();
  private closedReason: string | null = null;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly transport: LspTransport,
    options: LspClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;

    transport.onMessage((message) => this.receive(message));
    transport.onClose((reason) => {
      this.closedReason = reason;
      // Anything still waiting will never be answered. Fail it now with the
      // reason rather than letting it sit until its own timeout.
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error(`The Lean endpoint closed while ${pending.method} was in flight (${reason}).`),
        );
        this.pending.delete(id);
      }
    });
  }

  async start(): Promise<void> {
    await this.transport.open();
  }

  get isClosed(): boolean {
    return this.closedReason !== null;
  }

  async request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closedReason !== null) {
      throw new Error(`The Lean endpoint is closed (${this.closedReason}).`);
    }

    const id = this.nextId++;
    const limit = timeoutMs ?? this.requestTimeoutMs;

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} got no answer from the Lean endpoint within ${limit} ms.`));
      }, limit);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        method,
      });

      try {
        this.transport.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closedReason !== null) return;
    this.transport.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  on(method: string, handler: (params: unknown) => void): () => void {
    const handlers = this.notificationHandlers.get(method) ?? [];
    handlers.push(handler);
    this.notificationHandlers.set(method, handlers);
    return () => {
      const current = this.notificationHandlers.get(method) ?? [];
      const at = current.indexOf(handler);
      if (at >= 0) current.splice(at, 1);
    };
  }

  /**
   * Resolve once `predicate` accepts a notification, or reject on timeout.
   * Used to wait for Lean to report that it has finished a file.
   */
  waitFor(method: string, predicate: (params: unknown) => boolean, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out after ${timeoutMs} ms waiting for ${method}.`));
      }, timeoutMs);

      const off = this.on(method, (params) => {
        if (!predicate(params)) return;
        clearTimeout(timer);
        off();
        resolve(params);
      });
    });
  }

  private receive(message: JsonRpcMessage): void {
    if (isResponse(message)) {
      this.settle(message);
      return;
    }

    if (isNotification(message)) {
      for (const handler of this.notificationHandlers.get(message.method) ?? []) {
        handler(message.params);
      }
      return;
    }

    // A server request (configuration, registration). Nothing here needs to
    // answer meaningfully, but leaving one unanswered makes some servers stall.
    const asRequest = message as { id?: number | string; method?: string };
    if (asRequest.id !== undefined && asRequest.method !== undefined) {
      this.transport.send({ jsonrpc: '2.0', id: asRequest.id, result: null });
    }
  }

  private settle(response: JsonRpcResponse): void {
    if (response.id === null) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new LspError(response.error.code, response.error.message, pending.method));
    } else {
      pending.resolve(response.result);
    }
  }

  async stop(): Promise<void> {
    for (const [, pending] of this.pending) clearTimeout(pending.timer);
    this.pending.clear();
    await this.transport.close();
  }
}
