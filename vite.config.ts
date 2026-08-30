import { defineConfig } from 'vite';
// @ts-expect-error — plain .mjs backend, shared with the standalone server
import { aiBackendPlugin } from './server/aiHandler.mjs';

export default defineConfig({
  base: './',
  // Mounts /api/ai/* in both `vite` and `vite preview`. The OpenAI key lives in
  // this process's memory only — see server/aiHandler.mjs.
  plugins: [aiBackendPlugin()],
  server: {
    port: 5173,
    watch: {
      // Native CUDA binaries lock while llama-server is running; watching them
      // crashes Vite with EBUSY on Windows.
      ignored: ['**/local-ai-engine/**'],
    },
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    json: { stringify: true },
  },
});
