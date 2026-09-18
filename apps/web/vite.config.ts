import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import path from 'node:path';
import fs from 'node:fs';

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, './package.json'), 'utf-8'),
) as { version: string };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  envDir: path.resolve(import.meta.dirname, '../../'),
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
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
});
