import { createWorkspaceTasks } from '../../scripts/workspace-tasks.mjs';
import { defineConfig, lazyPlugins } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Its browser export uses document.createElement; workers need the pure entity map.
const entityDecoder = fileURLToPath(import.meta.resolve('decode-named-character-reference'));

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, './package.json'), 'utf-8'),
) as { version: string };

export default defineConfig(({ mode, command }) => ({
  run: createWorkspaceTasks(import.meta.dirname, {
    build: 'node ../../scripts/run-build-steps.mjs tsc -b -- vp build',
    dev: 'vp dev',
    typecheck: 'tsc --noEmit',
  }),
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  envDir: path.resolve(import.meta.dirname, '../../'),
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      // Development workers share the browser dependency optimizer.
      ...(command === 'serve' ? { 'decode-named-character-reference': entityDecoder } : {}),
      ...(mode === 'performance' ? { 'react-dom/client': 'react-dom/profiling' } : {}),
    },
  },
  worker: {
    plugins: () => [
      {
        name: 'worker-entity-decoder',
        enforce: 'pre',
        resolveId: (source) =>
          source === 'decode-named-character-reference' ? entityDecoder : null,
      },
    ],
  },
  build: {
    ...(mode === 'performance'
      ? { outDir: 'dist-performance' }
      : mode === 'gallery'
        ? { outDir: 'dist-gallery' }
        : {}),
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      ...(mode === 'performance'
        ? { input: path.resolve(import.meta.dirname, 'performance.html') }
        : {}),
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@xterm/')) return 'vendor-terminal';
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router-dom/')
          )
            return 'vendor-react';
          if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
          if (id.includes('node_modules/@tanstack/react-query')) return 'vendor-query';
          if (
            id.includes('node_modules/highlight.js') ||
            id.includes('node_modules/react-markdown') ||
            id.includes('node_modules/rehype-highlight') ||
            id.includes('node_modules/remark-gfm') ||
            id.includes('node_modules/micromark')
          ) {
            return 'vendor-markdown';
          }
          if (id.includes('node_modules/@tanstack/react-virtual')) return 'vendor-virtual';
          if (
            id.includes('node_modules/react-resizable-panels') ||
            id.includes('node_modules/sonner') ||
            id.includes('node_modules/@radix-ui') ||
            id.includes('node_modules/@floating-ui')
          ) {
            return 'vendor-ui';
          }
          if (id.includes('node_modules/zustand')) return 'vendor-state';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        ws: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
    },
  },
}));
