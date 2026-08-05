import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import fs from 'node:fs';

function copyDrizzlePlugin() {
  return {
    name: 'copy-drizzle',
    closeBundle() {
      const src = path.resolve(__dirname, '../../packages/core/drizzle');
      const dest = path.resolve(__dirname, 'drizzle');
      if (fs.existsSync(src)) {
        fs.mkdirSync(dest, { recursive: true });
        fs.cpSync(src, dest, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyDrizzlePlugin()],
    build: {
      rollupOptions: {
        external: ['electron', 'sodium-native'],
        input: {
          index: path.resolve(__dirname, 'src/main/index.ts'),
          'server-process': path.resolve(__dirname, 'src/main/server-process.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name].js',
          format: 'cjs',
        },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron'],
        input: {
          index: path.resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          format: 'cjs',
        },
      },
    },
  },

  renderer: {
    root: path.resolve(__dirname, '../web'),
    build: {
      outDir: path.resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, '../web/index.html'),
        },
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
    plugins: [react({}), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '../web/src'),
      },
    },
  },
});
