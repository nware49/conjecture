import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Tests run against source, not dist, so a stale build can never make a
  // failing change look green.
  resolve: {
    alias: {
      '@conjecture/core': src('core'),
      '@conjecture/lean': src('lean'),
      '@conjecture/refute': src('refute'),
      '@conjecture/server': src('server'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    environment: 'node',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/web/**'],
    },
  },
});
