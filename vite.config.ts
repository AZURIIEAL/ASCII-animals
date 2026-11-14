/// <reference types="vitest" />
import { defineConfig } from 'vite';

// `vite build` builds the standalone demo page.
// `vite build --mode lib` builds the single ES module used by the portfolio.
export default defineConfig(({ mode }) => ({
  build:
    mode === 'lib'
      ? {
          lib: {
            entry: 'src/index.ts',
            formats: ['es'] as const,
            fileName: () => 'ascii-field.js',
          },
          outDir: 'dist',
          target: 'es2020',
          emptyOutDir: true,
        }
      : { outDir: 'dist-demo', target: 'es2020', emptyOutDir: true },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
}));
