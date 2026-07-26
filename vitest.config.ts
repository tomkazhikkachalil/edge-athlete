import { defineConfig } from 'vitest/config';
import path from 'path';

// Mirrors tsconfig's "@/*" → "src/*" so modules using the path alias are
// testable. Test discovery stays on vitest defaults (**/*.test.ts).
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
