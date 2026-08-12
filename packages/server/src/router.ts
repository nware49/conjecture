/**
 * A small typed router over node:http.
 *
 * Fifteen endpoints do not need a framework, and the whole request path being
 * readable in one file is worth more here than the conveniences one would buy.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RequestContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly url: URL;
}

export type Handler = (ctx: RequestContext) => Promise<void> | void;

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];
  private fallback: Handler | null = null;

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split('/').filter((s) => s.length > 0),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: Handler): this {
    return this.add('GET', pattern, handler);
  }
  post(pattern: string, handler: Handler): this {
    return this.add('POST', pattern, handler);
  }
  patch(pattern: string, handler: Handler): this {
    return this.add('PATCH', pattern, handler);
  }
  delete(pattern: string, handler: Handler): this {
    return this.add('DELETE', pattern, handler);
  }

  /** Handler for anything unmatched — used to serve the client. */
  otherwise(handler: Handler): this {
    this.fallback = handler;
    return this;
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((s) => s.length > 0);
    let methodMismatch = false;

    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < parts.length; i += 1) {
        const segment = route.segments[i]!;
        const part = parts[i]!;
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(part);
        } else if (segment !== part) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      if (route.method !== method.toUpperCase()) {
        methodMismatch = true;
        continue;
      }
      return { handler: route.handler, params };
    }

    if (methodMismatch) {
      return {
        handler: ({ res }) => {
          res.writeHead(405, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not allowed for this path.' }));
        },
        params: {},
      };
    }

    return this.fallback ? { handler: this.fallback, params: {} } : null;
  }
}
