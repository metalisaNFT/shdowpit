import { defineConfig } from 'vite';
// @ts-expect-error — plain .mjs backend, shared with the standalone server
import { aiBackendPlugin } from './server/aiHandler.mjs';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    aiBackendPlugin(),
    mode === 'analyze' &&
      visualizer({
        filename: 'dist/stats.html',
        gzipSize: true,
        open: false,
      }),
  ].filter(Boolean),
  server: {
    port: 5173,
    watch: {
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
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 1200,
    json: { stringify: true },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('/src/god/') || id.includes('/src/ui/God')) return 'god';
          if (id.includes('/src/story/')) return 'story';
          if (id.includes('/src/comic/')) return 'comic';
        },
      },
    },
  },
}));
