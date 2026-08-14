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
  // `npm run lint` passes `--max-warnings 0`. That cap spent a year as a
  // RATCHET (45 → 43 → 30 → 19 → 11 → 7 → 0, lowered in the same commit that
  // removed the warnings); as of August 2026 it has reached zero and is a
  // GATE again. A warning now fails `npm run verify` like an error.
  //
  // The rules below stay `warn` rather than `error` on purpose: they describe
  // things worth flagging in an editor, and the zero cap is what makes them
  // binding in CI. If you hit one, fix it or add a targeted
  // `eslint-disable-next-line` WITH A REASON — do not raise the cap. Raising
  // it requires saying why in the DEVLOG.
  // (Until July 2026 this comment claimed `--max-warnings 0` while the script
  // was a bare `eslint .` — it described a guarantee the repo did not have.
  // The guarantee is real now; keep it that way.)
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
  // 80 files. Five of the six rules — refs, immutability, purity,
  // static-components, preserve-manual-memoization — were cleaned up at the
  // upgrade and stay at their default `error`.
  //
  // set-state-in-effect was the sixth, held at `warn` behind the ratchet while
  // 45 sites were worked down in reviewable batches (DEVLOG 2026-07-31 and the
  // 2026-08-11/12 batch entries). That work is DONE, so it is back at `error`
  // with the others. What the batches established, for the next person who
  // trips it:
  //
  //  • Every warning was a CALL SITE of a data-loading function invoked from
  //    an effect. The rule cannot see through a useCallback, so removing a
  //    synchronous setState does NOT clear it.
  //  • The fix is to inline the loader into its effect as a cancellable async
  //    IIFE (`let cancelled` + `if (!cancelled) setX(...)` + cleanup) — see
  //    src/components/workouts/RoutineManager.tsx or
  //    src/components/calendar/ActivityPreviewModal.tsx. Add a `reloadKey`
  //    when handlers also refetch, or publish the effect-local loader on a
  //    `useRef` when a handler must `await` it (VitalsTab, EventDetailModal).
  //    This is not busywork: it closed real stale-response races and two
  //    duplicate-fetch bugs.
  //  • A handful of sites are legitimately effect-owned and carry a targeted
  //    disable with the reason AT THE SITE: storage/window.location reads that
  //    would break hydration, realtime connection lifecycle, the media
  //    editor's object URLs (StrictMode revoke incident, DEVLOG July 26), and
  //    the three providers — lib/auth.tsx, lib/messages.tsx,
  //    lib/notifications.tsx — plus hooks/useSharedRound.ts and
  //    app/app/transfer/[profileId]/page.tsx, where the loader is shared with
  //    polls, realtime handlers or the hook's public API and duplicating it
  //    would be worse code than the annotation. Unused directives are
  //    themselves reported, so these cannot rot silently.
  //
  // NOTE the rule reports only the FIRST offending setState in an effect, and
  // it reports at the setState line, not the `useEffect(` line — put the
  // directive there or it lands as an unused directive AND leaves the
  // original problem. Read the exact line from `npx eslint . -f json`.
  //
  // Do not silence this by wrapping calls in `void (async () => …)()`. That
  // satisfies the analyzer without changing when anything executes.
  {
    rules: {
      'react-hooks/set-state-in-effect': 'error',
    },
  },

  // ── @next/next/no-location-assign-relative-destination ────────────────────
  // Arrived ON by default with eslint-config-next 16.3.1 (Aug 14 2026) and
  // reported 11 warnings, all pre-existing. Every one is an intentional HARD
  // navigation across an auth/session boundary, and each now carries an
  // inline disable with its reason at the site:
  //
  //   src/lib/auth.tsx (x2)                     sign-out, incl. the error path
  //   src/app/page.tsx                          username login
  //   src/app/activate/[token]/page.tsx         post-activation session pickup
  //   src/app/invite/[token]/page.tsx           new guardian access row
  //   src/app/goodbye/page.tsx                  post sign-out
  //   src/components/settings/DeleteAccountModal.tsx  account no longer exists
  //   src/components/settings/AccountSettings.tsx     exit to profile
  //   src/components/MultiSportActivity.tsx     route self-redirects per sport
  //   src/app/error.tsx, src/app/global-error.tsx     boundary recovery
  //
  // The rule's suggested fix (router.push) is WRONG for all of them: the whole
  // point is to discard client + Supabase state and let middleware re-run. For
  // global-error.tsx it is not even possible — the app shell is gone above that
  // boundary, so router/Link do not exist, as its own comment says.
  //
  // Deliberately NOT switched off wholesale: a new, accidental
  // `window.location.href` in ordinary UI code is still worth catching.

  // Stated explicitly rather than inherited from the package default: this is
  // the single line standing between us and a ~34,800-problem lint run, and it
  // should not live in a transitive default nobody can see.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**']),
]);
