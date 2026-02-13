import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), { encoding: 'utf-8' })
);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      // force a single React instance
      react: path.resolve(__dirname, 'node_modules/react'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),

      // ✅ IMPORTANT: point server import to the browser-friendly build
      'react-dom/server': path.resolve(__dirname, 'node_modules/react-dom/server.browser.js'),
    },
    dedupe: [
      'react',
      'react-dom',
      '@mui/material',
      '@mui/system',
      '@mui/icons-material',
      '@emotion/react',
      '@emotion/styled',
    ],
  },
  optimizeDeps: {
    include: [
      '@mui/material',
      '@mui/system',
      '@mui/icons-material',
      '@emotion/react',
      '@emotion/styled',
      '@mui/styled-engine',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ],
  },
  base: '',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        chunkFileNames: '[hash].js',
        entryFileNames: '[hash].js',
        assetFileNames: '[hash][extname]',
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Keep all third-party deps in one chunk to avoid cross-vendor
          // initialization cycles (e.g. React undefined during module init).
          return 'vendor';
        },
      },
    },
  },
});
