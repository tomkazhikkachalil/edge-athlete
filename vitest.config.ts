import { defineConfig } from 'vitest/config';
import path from 'path';

// Mirrors tsconfig's "@/*" → "src/*" so modules using the path alias are
// testable. Discovery is pinned to src/ so vitest can never wander into the
// Playwright suite under e2e/ (which uses *.spec.ts and its own runner).
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
