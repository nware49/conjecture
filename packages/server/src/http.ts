import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, detail?: string): HttpError =>
  new HttpError(400, message, detail ?? null);
export const notFound = (message: string): HttpError => new HttpError(404, message);
export const conflict = (message: string, detail?: string): HttpError =>
  new HttpError(409, message, detail ?? null);

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, jsonReplacer);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

/**
 * BigInts appear all through the search engine. Serialising them as strings
 * keeps exactness across the wire — a search space of 10^24 must not arrive at
 * the client as 1e+24.
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw badRequest('Request body too large.');
    chunks.push(buf);
  }

  if (chunks.length === 0) return {} as T;
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw badRequest(
      'Request body is not valid JSON.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

/** A server-sent events stream, used for live search progress. */
export class EventStream {
  private closed = false;

  constructor(private readonly res: ServerResponse) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    // Comment line so proxies flush the connection immediately.
    res.write(': open\n\n');
  }

  send(event: string, data: unknown): void {
    if (this.closed) return;
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data, jsonReplacer)}\n\n`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`\`${field}\` is required.`);
  }
  return value;
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`\`${field}\` must be a string.`);
  return value;
}
