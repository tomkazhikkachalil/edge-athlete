// ESLint flat config, native shape (Next 16 removed `next lint`; we call the
// ESLint CLI directly via `npm run lint`).
//
// NOT the FlatCompat shape the official `next-lint-to-eslint-cli` codemod
// emits: `compat.extends()` translates eslintrc rules/plugins/parser only and
// CANNOT carry flat-config `ignores`. `next lint` used to scope itself to the
// source directories; `eslint .` does not — with the compat shape, a bare run
// lints `.next/` build output and reports ~34,800 problems. These entry points
// (`eslint-config-next/core-web-vitals`, `/typescript`) are the real package
// exports and ship the right defaults.
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  // Rule overrides come AFTER the spreads — flat config is last-wins.
  // `npm run lint` passes --max-warnings 0, so these are gated, not advisory.
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      '@next/next/no-img-element': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
      '@next/next/no-page-custom-font': 'warn',
      'react/no-unescaped-entities': 'warn',
    },
  },

  // TEMPORARY — eslint-config-next 16 bundles eslint-plugin-react-hooks v6,
  // whose React Compiler rules land as errors and flag 121 pre-existing sites
  // across 80 files. They are being fixed in the commits that follow this one;
  // this block is deleted (rules return to their default `error`) in the final
  // commit of that series, together with `--max-warnings 0`. If you are reading
  // this on `main`, the series did not finish — that is a bug, not a decision.
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },

  // Stated explicitly rather than inherited from the package default: this is
  // the single line standing between us and a ~34,800-problem lint run, and it
  // should not live in a transitive default nobody can see.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
