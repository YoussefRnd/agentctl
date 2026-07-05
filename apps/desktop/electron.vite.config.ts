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
    }
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyDrizzlePlugin()],
    build: {
      rollupOptions: {
        external: ['electron', 'better-sqlite3', 'sodium-native'],
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
