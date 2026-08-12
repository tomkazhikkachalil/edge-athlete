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
  // `npm run lint` passes `--max-warnings 30`, so these are a RATCHET, not a
  // gate: the 30 known warnings below are tolerated, and warning number 31
  // fails `npm run verify`. The cap is not 0 yet because the remainder is a
  // known, documented list (see the set-state-in-effect note below) being
  // worked down in reviewable batches — a number that can only go down beats
  // a rushed sweep or a blanket disable.
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
  // set-state-in-effect is held at `warn` for the 30 that remain (was 45 at
  // the Next 16 upgrade, then 43; DEVLOG 2026-07-31 and the batch entries).
  // Every remaining warning is a CALL SITE of a data-loading function invoked
  // from an effect: the rule cannot see through a useCallback, so removing
  // synchronous setState does NOT clear it. The fix is to inline the loader
  // into its effect as a cancellable async IIFE — see
  // src/components/workouts/RoutineManager.tsx or
  // src/components/calendar/ActivityPreviewModal.tsx for the sanctioned shape,
  // adding a `reloadKey` when event handlers also need to refetch.
  //
  // The genuinely effect-owned cases no longer count here: they now carry a
  // targeted `eslint-disable-next-line` with the reason at the site (storage
  // and window.location reads that would break hydration, realtime connection
  // lifecycle, and the media editor's object URLs — see the StrictMode revoke
  // incident in DEVLOG, July 26). Annotating beats an opaque cap: the reason
  // lives next to the code, and unused directives are themselves reported.
  //
  // NOTE the rule reports only the FIRST offending setState in an effect, and
  // it reports at the setState line, not the `useEffect(` line — put the
  // directive there or it lands as an unused directive AND leaves the
  // original warning.
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
