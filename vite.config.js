import { defineConfig } from 'vite';

export default defineConfig({
  assetsInclude: ['**/*.wasm'],
  // Keep application/dependency files read-only for the unprivileged server.
  cacheDir: `/tmp/book4matter-vite-${process.pid}`,
  worker: { format: 'es' },
  build: { target: 'esnext' },
});
