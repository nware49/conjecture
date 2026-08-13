#!/usr/bin/env node
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientIsBuilt, createApp } from './app.js';
import { probeEndpoint } from './probe.js';
import { SearchRunner } from './search-runner.js';
import { seedWorkspace } from './seed.js';
import { ConjectureService } from './service.js';
import { JsonFileRepository } from './store.js';

interface Options {
  port: number;
  host: string;
  dataDir: string;
  clientDir: string;
  seed: boolean;
  project: string | null;
  leanEndpoint: string | null;
  leanProject: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const here = dirname(fileURLToPath(import.meta.url));
  const options: Options = {
    port: Number(process.env['PORT'] ?? 4319),
    host: process.env['HOST'] ?? '127.0.0.1',
    dataDir: process.env['CONJECTURE_DATA'] ?? resolve(process.cwd(), '.conjecture'),
    clientDir: process.env['CONJECTURE_CLIENT'] ?? resolve(here, '../../web/dist'),
    seed: true,
    project: null,
    leanEndpoint: process.env['CONJECTURE_LEAN_ENDPOINT'] ?? null,
    leanProject: process.env['CONJECTURE_LEAN_PROJECT'] ?? null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--port':
        options.port = Number(next());
        break;
      case '--host':
        options.host = next();
        break;
      case '--data':
        options.dataDir = resolve(next());
        break;
      case '--client':
        options.clientDir = resolve(next());
        break;
      case '--project':
        options.project = resolve(next());
        break;
      case '--lean-endpoint':
        options.leanEndpoint = next();
        break;
      case '--lean-project':
        options.leanProject = next();
        break;
      case '--no-seed':
        options.seed = false;
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown flag ${arg}.`);
    }
  }

  return options;
}

function printHelp(): void {
  process.stdout.write(
    [
      'conjecture — a proof workspace where Claude proposes and Lean decides',
      '',
      'Usage: conjecture [options]',
      '',
      '  --port <n>        Port to listen on (default 4319)',
      '  --host <addr>     Address to bind (default 127.0.0.1)',
      '  --data <dir>      Where the workspace file lives (default ./.conjecture)',
      '  --client <dir>    Built web client to serve',
      '  --project <dir>   Connect a Lean project on this machine at startup',
      '  --lean-endpoint <url>',
      '                    Use a Lean server elsewhere. Nothing is installed here.',
      '                    Accepts https://host (becomes wss://host/websocket/<project>)',
      '                    or an explicit wss:// URL.',
      '  --lean-project <name>',
      '                    Project served by that endpoint (default mathlib)',
      '  --no-seed         Start with an empty library',
      '',
      'Commands:',
      '  probe <url>       Check a Lean endpoint and report what it can actually do',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === 'probe') {
    const endpoint = argv[1];
    if (!endpoint) throw new Error('probe needs an endpoint, e.g. conjecture probe https://lean.example.org');
    const report = await probeEndpoint(endpoint, argv[2]);
    process.stdout.write(`${report.lines.join('\n')}\n`);
    process.exit(report.ok ? 0 : 1);
  }

  const options = parseArgs(argv);

  const service = await ConjectureService.open({
    repository: JsonFileRepository.inDirectory(options.dataDir),
  });
  const runner = new SearchRunner();

  if (options.leanEndpoint) {
    const result = await service.connectRemote(
      options.leanEndpoint,
      options.leanProject ?? undefined,
    );
    const health = result.health;
    process.stdout.write(
      `lean endpoint ${options.leanEndpoint}: ${health.status === 'unavailable' ? health.reason : health.detail}\n`,
    );
  } else if (options.project) {
    const result = await service.connect(options.project);
    const health = result.health;
    process.stdout.write(
      `project ${options.project}: ${health.status === 'unavailable' ? health.reason : health.detail}\n`,
    );
  }

  const server = createServer(createApp({ service, runner, clientDir: options.clientDir }));

  // A port clash is an ordinary thing to hit twice in a morning. It deserves a
  // sentence, not an unhandled 'error' event and a Node stack trace.
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      process.stderr.write(
        `Port ${options.port} is already in use, most likely by another Conjecture.\n` +
          `Stop that one, or start this on a different port: npm start -- --port ${options.port + 1}\n`,
      );
    } else if (error.code === 'EACCES') {
      process.stderr.write(
        `Not allowed to bind ${options.host}:${options.port}. Ports below 1024 usually need elevated privileges.\n`,
      );
    } else {
      process.stderr.write(`${error.message}\n`);
    }
    process.exit(1);
  });

  const built = await clientIsBuilt(options.clientDir);

  server.listen(options.port, options.host, () => {
    process.stdout.write(`Conjecture 1.0.0 listening on http://${options.host}:${options.port}\n`);
    process.stdout.write(`  workspace  ${join(options.dataDir, 'workspace.json')}\n`);
    process.stdout.write(`  client     ${options.clientDir}${built ? '' : '  (NOT BUILT)'}\n`);

    if (!built) {
      // Printing the path and then quietly serving errors is how someone ends
      // up debugging the router instead of running one command.
      process.stderr.write(
        `\nThe web client has not been built, so the browser will show a notice instead of the app.\n` +
          `Run \`npm run build\` from the repository root, then reload.\n` +
          `The API itself is up: try http://${options.host}:${options.port}/api/health\n\n`,
      );
    }

    if (options.seed) {
      // Seeding runs real searches, so it happens after the socket is open —
      // the interface should be usable while its own demo is being computed.
      void seedWorkspace(service, runner).then(
        () => process.stdout.write('seeded the example library\n'),
        (error: unknown) =>
          process.stderr.write(`seeding failed: ${error instanceof Error ? error.message : String(error)}\n`),
      );
    }
  });

  const shutdown = (): void => {
    runner.cancelAll();
    server.close(() => process.exit(0));
    // Do not wait indefinitely for a keep-alive connection to drain.
    setTimeout(() => process.exit(0), 2_000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
