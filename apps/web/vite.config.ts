import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: path.resolve(__dirname, '../../'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react')) return 'vendor-react';
          if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
          if (id.includes('node_modules/@tanstack/react-query')) return 'vendor-query';
          if (id.includes('node_modules/highlight.js')) return 'vendor-markdown';
          if (id.includes('node_modules/react-markdown')) return 'vendor-markdown';
          if (id.includes('node_modules/rehype-highlight')) return 'vendor-markdown';
          if (id.includes('node_modules/remark-gfm')) return 'vendor-markdown';
          if (id.includes('node_modules/react-virtuoso')) return 'vendor-list';
          if (id.includes('node_modules/react-resizable-panels')) return 'vendor-ui';
          if (id.includes('node_modules/sonner')) return 'vendor-ui';
          if (id.includes('node_modules/zustand')) return 'vendor-state';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/ws': {
        target: 'ws://127.0.0.1:3000',
        ws: true,
      },
    },
  },
});
