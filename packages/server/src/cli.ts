#!/usr/bin/env node
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
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
      '  --project <dir>   Connect this Lean project on startup',
      '  --no-seed         Start with an empty library',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const service = await ConjectureService.open({
    repository: JsonFileRepository.inDirectory(options.dataDir),
  });
  const runner = new SearchRunner();

  if (options.project) {
    const result = await service.connect(options.project);
    const health = result.health;
    process.stdout.write(
      `project ${options.project}: ${health.status === 'unavailable' ? health.reason : health.detail}\n`,
    );
  }

  const server = createServer(createApp({ service, runner, clientDir: options.clientDir }));

  server.listen(options.port, options.host, () => {
    process.stdout.write(`Conjecture 1.0.0 listening on http://${options.host}:${options.port}\n`);
    process.stdout.write(`  workspace  ${join(options.dataDir, 'workspace.json')}\n`);
    process.stdout.write(`  client     ${options.clientDir}\n`);

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
