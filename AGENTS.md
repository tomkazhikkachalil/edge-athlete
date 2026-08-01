# AGENTS.md

**Multi-Sport Athlete Social Network** — Next.js 16 App Router + Supabase + TypeScript
(strict). Golf is the only fully implemented sport; see `package.json` for the real stack.

## → The conventions live in `CLAUDE.md`

Read **`CLAUDE.md`** first. It is the canonical guide for this repo: environment setup,
development commands and the `npm run verify` gate, architecture, navigation invariants,
the design system, privacy rules and common tasks.

Two things it will send you to, worth knowing up front:

- **`src/app/api/CLAUDE.md`** — the **required** API route patterns. Every route uses
  cookie-header auth (*not* `await cookies()`). Read it before writing a route.
- **`DEVLOG.md`** — why things are the way they are. Check it before assuming a decision
  was arbitrary; a lot of what looks odd here is load-bearing and the reason is recorded.

## Why this file is a pointer

Until August 2026 this was a 408-line near-duplicate of CLAUDE.md — about 60% of it
byte-identical. That is exactly the failure mode it was supposed to prevent: the July
2026 documentation cleanup corrected CLAUDE.md and missed this file, so within a single
session the two had diverged and this copy was left asserting things that were no longer
true — Next.js 15, three sports instead of eleven, an env var whose consuming routes had
been deleted, and fifteen links to documents that no longer existed.

Two files claiming to be the source of truth means one of them is quietly wrong, and a
reader cannot tell which. So: **do not re-expand this file.** If something belongs in
project guidance, it belongs in `CLAUDE.md`. Add here only what is genuinely specific to
a non-Claude agent and true nowhere else.
