import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import obfuscator from 'vite-plugin-obfuscator-ts';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), obfuscator({
    obfuscatorOptions: {
      // IMPORTANT: only run in production builds
      apply: 'build',
      // Only obfuscate your app code, never node_modules or virtual chunks
      include: [/src\/.*\.(ts|tsx)$/],
      exclude: [/node_modules/, /@vite/, /virtual:/],
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.4,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.2,
      debugProtection: false,
      debugProtectionInterval: 0,
      disableConsoleOutput: false,
      identifierNamesGenerator: 'hexadecimal',
      log: true,
      numbersToExpressions: true,
      renameGlobals: false,
      selfDefending: false,
      simplify: true,
      splitStrings: true,
      splitStringsChunkLength: 6, 
      stringArray: true,
      stringArrayCallsTransform: true,
      stringArrayCallsTransformThreshold: 0.7,
      stringArrayEncoding: ['rc4', 'base64'],
      stringArrayIndexShift: true,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayWrappersCount: 2,
      stringArrayWrappersChainedCalls: true,
      stringArrayWrappersParametersMaxCount: 2,
      stringArrayWrappersType: 'variable',
      stringArrayThreshold: 1,
      unicodeEscapeSequence: true,
    },
    
  }),],
  resolve: {
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
    // exclude: ['react', 'react-dom'],
    include: [
      '@mui/material',
      '@mui/system',
      '@mui/icons-material',
      '@emotion/react',
      '@emotion/styled',
    ],
  },
  base: '',
  build: {
    // Don’t ship “cheat sheets”
    sourcemap: false,

    // Use terser to get deeper mangling than esbuild
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 3,
        toplevel: true,
        pure_getters: true,
        unsafe: true,
        unsafe_arrows: true,
        unsafe_methods: true,
      },
      mangle: {
        toplevel: true,
        eval: true,
        safari10: false,
        keep_classnames: false,
        keep_fnames: false,
      },
      format: {
        comments: false,
      },
    },

    // Smaller bundles & fewer hints for RE
    target: 'es2019',
    cssTarget: 'chrome100',

    // If you split chunks, obfuscate the sensitive ones (see files: filter above)
    rollupOptions: {
      output: {
        // Avoid human-readable chunk names
        chunkFileNames: 'assets/[hash].js',
        entryFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
      },
      treeshake: true,
    },
  },

  define: {
  },

});

