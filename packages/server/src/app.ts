import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { asSearchId, buildGraph } from '@conjecture/core';
import { EXAMPLES, type SearchRequest, type VariableSpace } from '@conjecture/refute';
import {
  EventStream,
  HttpError,
  badRequest,
  notFound,
  readJsonBody,
  requireString,
  sendJson,
} from './http.js';
import { Router, type RequestContext } from './router.js';
import { SearchRunner } from './search-runner.js';
import { toClaimDto, toWorkspaceDto } from './serialize.js';
import type { ConjectureService } from './service.js';

export interface AppOptions {
  readonly service: ConjectureService;
  readonly runner: SearchRunner;
  /** Directory of built client assets. Omitted in API-only tests. */
  readonly clientDir?: string;
}

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createApp(options: AppOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const { service, runner } = options;
  const router = new Router();

  router.get('/api/health', async ({ res }) => {
    sendJson(res, 200, {
      status: 'ok',
      version: '1.0.0',
      engine: await service.engineHealth(),
    });
  });

  router.get('/api/workspace', async ({ res }) => {
    sendJson(res, 200, toWorkspaceDto(await service.workspace()));
  });

  router.post('/api/project/connect', async ({ req, res }) => {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const root = requireString(body, 'root');
    const result = await service.connect(resolve(root));
    sendJson(res, 200, { ...result, workspace: toWorkspaceDto(await service.workspace()) });
  });

  router.post('/api/project/disconnect', async ({ res }) => {
    await service.disconnect();
    sendJson(res, 200, toWorkspaceDto(await service.workspace()));
  });

  router.get('/api/claims', async ({ res }) => {
    const pin = service.pin;
    sendJson(res, 200, service.claims.map((claim) => toClaimDto(claim, pin)));
  });

  router.post('/api/claims', async ({ req, res }) => {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const claim = await service.createClaim({
      title: requireString(body, 'title'),
      prose: typeof body['prose'] === 'string' ? body['prose'] : undefined,
      lean: typeof body['lean'] === 'string' ? body['lean'] : undefined,
      assumptions: Array.isArray(body['assumptions'])
        ? (body['assumptions'] as string[])
        : undefined,
    });
    sendJson(res, 201, toClaimDto(claim, service.pin));
  });

  router.get('/api/claims/:id', ({ res, params }) => {
    sendJson(res, 200, toClaimDto(service.claim(params['id']!), service.pin));
  });

  router.patch('/api/claims/:id', async ({ req, res, params }) => {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const claim = await service.updateClaim(params['id']!, {
      title: typeof body['title'] === 'string' ? body['title'] : undefined,
      prose: typeof body['prose'] === 'string' ? body['prose'] : undefined,
      lean: typeof body['lean'] === 'string' ? body['lean'] : undefined,
      assumptions: Array.isArray(body['assumptions']) ? (body['assumptions'] as string[]) : undefined,
      confirmSync: body['confirmSync'] === true,
    });
    sendJson(res, 200, toClaimDto(claim, service.pin));
  });

  router.delete('/api/claims/:id', async ({ res, params }) => {
    await service.deleteClaim(params['id']!);
    sendJson(res, 200, { deleted: params['id'] });
  });

  router.post('/api/claims/:id/verify', async ({ res, params }) => {
    const result = await service.verify(params['id']!);
    sendJson(res, 200, {
      claim: toClaimDto(result.claim, service.pin),
      diagnostics: result.diagnostics,
      error: result.error,
    });
  });

  router.post('/api/claims/:id/weaken', async ({ res, params }) => {
    const weakened = await service.weaken(params['id']!);
    sendJson(res, 201, toClaimDto(weakened, service.pin));
  });

  router.post('/api/claims/:id/search', async ({ req, res, params }) => {
    const claim = service.claim(params['id']!);
    const body = await readJsonBody<Record<string, unknown>>(req);
    const request = parseSearchRequest(body);
    const record = runner.start(request, claim.id);
    sendJson(res, 202, runner.describe(record));
  });

  router.get('/api/searches', ({ res }) => {
    sendJson(res, 200, runner.list().map((record) => runner.describe(record)));
  });

  router.get('/api/searches/:id', ({ res, params }) => {
    const record = runner.get(asSearchId(params['id']!));
    if (!record) throw notFound(`No search with id ${params['id']}.`);
    sendJson(res, 200, runner.describe(record));
  });

  router.post('/api/searches/:id/cancel', ({ res, params }) => {
    const id = asSearchId(params['id']!);
    if (!runner.get(id)) throw notFound(`No search with id ${params['id']}.`);
    sendJson(res, 200, { cancelled: runner.cancel(id) });
  });

  router.get('/api/searches/:id/events', ({ req, res, params }) => {
    const id = asSearchId(params['id']!);
    const record = runner.get(id);
    if (!record) throw notFound(`No search with id ${params['id']}.`);

    const stream = new EventStream(res);
    stream.send('status', runner.describe(record));

    const unsubscribe = runner.subscribe(id, (event, data) => {
      stream.send(event, data);
      if (event === 'done') {
        // Give the client a tick to read the final frame before closing.
        setTimeout(() => stream.close(), 20);
      }
    });

    req.on('close', () => {
      unsubscribe();
      stream.close();
    });
  });

  /** Apply a finished search to its claim. The client asks; it does not decide. */
  router.post('/api/searches/:id/apply', async ({ res, params }) => {
    const record = runner.get(asSearchId(params['id']!));
    if (!record) throw notFound(`No search with id ${params['id']}.`);
    if (!record.outcome) throw badRequest('That search has not finished yet.');
    if (record.claimId === null) throw badRequest('That search is not attached to a claim.');

    const claim = await service.applySearchOutcome(
      record.claimId,
      record.outcome,
      record.request,
      record.id,
    );
    sendJson(res, 200, toClaimDto(claim, service.pin));
  });

  router.get('/api/graph', ({ res, query }) => {
    const goal = query.get('goal');
    const graph = buildGraph(service.claims, {
      goal: goal ? service.claimIdsFrom([goal])[0]! : null,
      pin: service.pin,
    });
    sendJson(res, 200, graph);
  });

  router.get('/api/examples', ({ res }) => {
    sendJson(
      res,
      200,
      EXAMPLES.map((example) => ({
        id: example.id,
        title: example.title,
        prose: example.prose,
        lean: example.lean,
        note: example.note,
        expect: example.expect,
        request: {
          ...example.request,
          variables: example.request.variables.map((v) => ({
            name: v.name,
            from: v.from.toString(),
            to: v.to.toString(),
            step: (v.step ?? 1n).toString(),
          })),
        },
      })),
    );
  });

  if (options.clientDir) {
    router.otherwise(({ req, res, url }) => serveStatic(options.clientDir!, req, res, url));
  } else {
    router.otherwise(({ res }) => {
      sendJson(res, 404, { error: 'Not found.' });
    });
  }

  return (req, res) => {
    void handle(router, req, res);
  };
}

async function handle(router: Router, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const matched = router.match(req.method ?? 'GET', url.pathname);

  if (!matched) {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  const ctx: RequestContext = {
    req,
    res,
    params: matched.params,
    query: url.searchParams,
    url,
  };

  try {
    await matched.handler(ctx);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message, detail: error.detail });
      return;
    }
    // An unexpected failure is reported as one. Swallowing it would leave the
    // client showing stale state that looks like current state.
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unexpected server error.',
      detail: null,
    });
  }
}

function parseSearchRequest(body: Record<string, unknown>): SearchRequest {
  const variablesRaw = body['variables'];
  if (!Array.isArray(variablesRaw) || variablesRaw.length === 0) {
    throw badRequest('A search needs at least one variable with a range.');
  }

  const variables: VariableSpace[] = variablesRaw.map((raw, index) => {
    const v = raw as Record<string, unknown>;
    const name = typeof v['name'] === 'string' ? v['name'] : null;
    if (!name) throw badRequest(`Variable ${index} has no name.`);
    try {
      const step = v['step'] === undefined ? undefined : BigInt(String(v['step']));
      if (step !== undefined && step <= 0n) throw badRequest(`Step for ${name} must be positive.`);
      return {
        name,
        from: BigInt(String(v['from'] ?? '0')),
        to: BigInt(String(v['to'] ?? '0')),
        ...(step === undefined ? {} : { step }),
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw badRequest(`Bounds for ${name} must be integers.`);
    }
  });

  const strategy = body['strategy'] === 'random' ? 'random' : 'enumerate';
  const budgetMs = clampNumber(body['budgetMs'], 1_000, 300_000, 20_000);
  const maxCandidates = clampNumber(body['maxCandidates'], 1, 50_000_000, 1_000_000);

  return {
    definitions: typeof body['definitions'] === 'string' ? body['definitions'] : '',
    predicate: requireString(body, 'predicate'),
    variables,
    strategy,
    budgetMs,
    maxCandidates,
    report: Array.isArray(body['report'])
      ? (body['report'] as { label: string; expr: string }[])
      : [],
    ...(typeof body['seed'] === 'number' ? { seed: body['seed'] } : {}),
    ...(typeof body['traceSize'] === 'number' ? { traceSize: body['traceSize'] } : {}),
  };
}

function clampNumber(raw: unknown, min: number, max: number, fallback: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * Has the client actually been built? Checked before serving so a missing
 * build reports itself instead of looking like a routing bug.
 */
export async function clientIsBuilt(root: string): Promise<boolean> {
  try {
    await stat(join(root, 'index.html'));
    return true;
  } catch {
    return false;
  }
}

const NOT_BUILT_MESSAGE = 'The web client has not been built.';

function sendNotBuilt(res: ServerResponse, root: string): void {
  // A bare 404 here sent at least one person hunting through the router. The
  // API is fine; the asset is missing, and the fix is one command.
  const body = `<!doctype html>
<meta charset="utf-8">
<title>Conjecture — client not built</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; margin: 12vh auto; max-width: 46rem; padding: 0 1.5rem; color: #14161C; }
  code { background: #EDEFF2; padding: 2px 6px; font-family: ui-monospace, monospace; }
  pre { background: #F7F8FA; border: 1px solid #D5D9DF; padding: 12px 14px; overflow-x: auto; }
  .m { color: #616A7B; font-size: 13px; }
</style>
<h1>The web client has not been built.</h1>
<p>The API is running and answering on <code>/api/health</code>. There is just nothing to serve at this path yet.</p>
<pre>npm run build</pre>
<p>Then reload. For hot reload while developing, run <code>npm run dev</code> and open the client on its own port instead.</p>
<p class="m">Looked for <code>index.html</code> in ${escapeHtml(root)}</p>`;

  res.writeHead(503, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;',
  );
}

async function serveStatic(
  root: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (!(await clientIsBuilt(root))) {
    sendNotBuilt(res, root);
    return;
  }

  // Resolve inside the client directory and refuse anything that escapes it.
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, requested);
  if (!filePath.startsWith(resolve(root))) filePath = join(root, 'index.html');

  let target = filePath;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) target = join(filePath, 'index.html');
  } catch {
    // Unknown path: hand back the client shell so its router can take over.
    target = join(root, 'index.html');
  }

  try {
    await stat(target);
  } catch {
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  const type = MIME[extname(target)] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': target.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
  });
  createReadStream(target).pipe(res);
  void req;
}
