/**
 * The transport boundary.
 *
 * The socket is a port so the client above it can be tested against scripted
 * server traffic. That matters more than usual here: the environments where
 * this code is written and the environments where it runs rarely have a Lean
 * server in reach of each other.
 */

import { decodeFrame, encodeFrame, type JsonRpcMessage } from './jsonrpc.js';

export interface LspTransport {
  open(): Promise<void>;
  send(message: JsonRpcMessage): void;
  onMessage(handler: (message: JsonRpcMessage) => void): void;
  onClose(handler: (reason: string) => void): void;
  close(): Promise<void>;
}

export interface WebSocketTransportOptions {
  readonly url: string;
  readonly framing?: 'plain' | 'content-length';
  readonly openTimeoutMs?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A transport over the WebSocket built into Node 22. No dependency, and the
 * same code runs in a browser if that is ever wanted.
 */
export class WebSocketTransport implements LspTransport {
  private socket: WebSocket | null = null;
  private readonly messageHandlers: ((message: JsonRpcMessage) => void)[] = [];
  private readonly closeHandlers: ((reason: string) => void)[] = [];
  private readonly framing: 'plain' | 'content-length';
  private closed = false;

  constructor(private readonly options: WebSocketTransportOptions) {
    this.framing = options.framing ?? 'plain';
  }

  async open(): Promise<void> {
    if (typeof WebSocket === 'undefined') {
      throw new Error(
        'This Node build has no global WebSocket. Node 22.4 or newer is required for a remote Lean endpoint.',
      );
    }

    const timeoutMs = this.options.openTimeoutMs ?? 20_000;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.options.url);
      this.socket = socket;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(
          new Error(
            `The Lean endpoint at ${this.options.url} did not accept a WebSocket connection within ${timeoutMs} ms.`,
          ),
        );
      }, timeoutMs);

      socket.addEventListener('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      });

      socket.addEventListener('error', () => {
        // The DOM error event carries no detail. Say where it happened and let
        // the close event supply a code if one arrives.
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Could not connect to the Lean endpoint at ${this.options.url}.`));
      });

      socket.addEventListener('message', (event: { data: unknown }) => {
        const raw = typeof event.data === 'string' ? event.data : String(event.data);
        const message = decodeFrame(raw);
        if (message === null) return;
        for (const handler of this.messageHandlers) handler(message);
      });

      socket.addEventListener('close', (event: { code: number; reason: string }) => {
        this.closed = true;
        const reason = event.reason?.length > 0 ? event.reason : `code ${event.code}`;
        for (const handler of this.closeHandlers) handler(reason);
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`The Lean endpoint closed the connection during the handshake (${reason}).`));
      });
    });
  }

  send(message: JsonRpcMessage): void {
    if (this.socket === null || this.closed) {
      throw new Error('The connection to the Lean endpoint is not open.');
    }
    this.socket.send(encodeFrame(message, this.framing));
  }

  onMessage(handler: (message: JsonRpcMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  onClose(handler: (reason: string) => void): void {
    this.closeHandlers.push(handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }
}
