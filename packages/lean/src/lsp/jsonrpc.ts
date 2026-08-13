/**
 * JSON-RPC 2.0, the subset the Language Server Protocol uses.
 *
 * Two framings exist in the wild. A Lean server over a pipe uses
 * `Content-Length` headers; the same server proxied over a WebSocket usually
 * gets one JSON value per message with no headers. The decoder accepts both,
 * because getting this wrong looks exactly like a server that never answers.
 */

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc: '2.0';
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: number | string | null;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return 'id' in message && !('method' in message);
}

export function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
  return 'method' in message && !('id' in message);
}

export function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return 'method' in message && 'id' in message;
}

/**
 * Decode one frame off the wire.
 *
 * Returns null rather than throwing on junk: a proxy that injects a heartbeat
 * or a blank keep-alive should not take down an elaboration.
 */
export function decodeFrame(raw: string): JsonRpcMessage | null {
  const text = raw.trim();
  if (text.length === 0) return null;

  const body = text.startsWith('Content-Length:') ? stripHeaders(text) : text;
  if (body === null) return null;

  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (!('jsonrpc' in parsed)) return null;
    return parsed as JsonRpcMessage;
  } catch {
    return null;
  }
}

function stripHeaders(text: string): string | null {
  const separator = text.indexOf('\r\n\r\n');
  if (separator >= 0) return text.slice(separator + 4);
  const loose = text.indexOf('\n\n');
  return loose >= 0 ? text.slice(loose + 2) : null;
}

export function encodeFrame(message: JsonRpcMessage, framing: 'plain' | 'content-length'): string {
  const body = JSON.stringify(message);
  if (framing === 'plain') return body;
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

/** LSP diagnostic severities, as numbers on the wire. */
export const SEVERITY = { error: 1, warning: 2, information: 3, hint: 4 } as const;

export function severityName(value: number | undefined): 'error' | 'warning' | 'information' {
  if (value === SEVERITY.error) return 'error';
  if (value === SEVERITY.warning) return 'warning';
  return 'information';
}
