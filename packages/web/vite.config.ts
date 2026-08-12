import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env['CONJECTURE_API'] ?? 'http://127.0.0.1:4319';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5319,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // Search progress arrives over SSE, which must not be buffered.
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
            }
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
