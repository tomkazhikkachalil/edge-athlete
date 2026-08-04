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
  //
  // `npm run lint` passes `--max-warnings 45`, so these are a RATCHET, not a
  // gate: the 45 known warnings below are tolerated, and warning number 46
  // fails `npm run verify`. The cap is not 0 because the remaining 45 are a
  // known, documented list (see the set-state-in-effect note below) and
  // demanding 0 today would mean either a rushed sweep or a blanket disable —
  // both worse than a number that can only go down.
  //
  // When you legitimately remove warnings, LOWER this cap in package.json in
  // the same commit. Raising it requires saying why in the DEVLOG.
  // (Until July 2026 this comment claimed `--max-warnings 0` while the script
  // was a bare `eslint .` — it described a guarantee the repo did not have.)
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

  // eslint-config-next 16 bundles eslint-plugin-react-hooks v6, whose React
  // Compiler rules arrived as errors and flagged 121 pre-existing sites across
  // 80 files. 76 were fixed (see the fix(react-hooks) commits); five of the six
  // rules — refs, immutability, purity, static-components,
  // preserve-manual-memoization — are clean and stay at their default `error`.
  //
  // set-state-in-effect is held at `warn` for the 45 that remain, deliberately
  // and with a known list (DEVLOG, 2026-07-31). Two kinds are left:
  //
  //   1. The rule flags the CALL SITE of any function containing setState,
  //      invoked from an effect — it cannot see through a useCallback, so
  //      removing every synchronous setState does NOT clear it. Satisfying it
  //      means inlining ~31 data-fetching functions into their effects as
  //      cancellable async IIFEs. Worth doing, but as its own PR with its own
  //      testing, not inside a framework upgrade.
  //   2. ~13 are legitimately effects: browser-API reads on mount that would
  //      break hydration if moved into render (sessionStorage, location),
  //      realtime connection lifecycle, and the media editor's object URLs,
  //      which MUST stay effect-owned (see DEVLOG, the StrictMode revoke bug).
  //
  // Do not silence this by wrapping calls in `void (async () => …)()`. That
  // satisfies the analyzer without changing when anything executes.
  {
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // Stated explicitly rather than inherited from the package default: this is
  // the single line standing between us and a ~34,800-problem lint run, and it
  // should not live in a transitive default nobody can see.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**']),
]);
