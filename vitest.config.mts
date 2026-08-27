import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

// .mts so Vite loads this as ESM — the .ts form was loaded as CommonJS and
// warned on every test run about the future `configLoader: 'native'`
// default. ESM has no __dirname, hence the fileURLToPath dance (chosen over
// import.meta.dirname for Node <20.11 compatibility).
const configDir = path.dirname(fileURLToPath(import.meta.url));

// Mirrors tsconfig's "@/*" → "src/*" so modules using the path alias are
// testable. Discovery is pinned to src/ so vitest can never wander into the
// Playwright suite under e2e/ (which uses *.spec.ts and its own runner).
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(configDir, 'src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
