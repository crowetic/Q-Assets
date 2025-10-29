import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // force a single React instance
      react: path.resolve(__dirname, 'node_modules/react'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),

      // ✅ IMPORTANT: point server import to the browser-friendly build
      'react-dom/server': path.resolve(
        __dirname,
        'node_modules/react-dom/server.browser.js'
      ),

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
      },
    },
  },
});
