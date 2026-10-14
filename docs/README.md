# docs/ — the reference documents

- `devlog.md` — the running development log (was the root `DEVLOG.md` until Oct 13 2026). Every round, decision and maintenance pass; new entries go at the top.
- `devlog/` — the OLD devlog (2025 entries 001–010), history only.
- `specs/` — the feature specs, one file per area; `specs/README.md` maps every convention number to its file.

## Reference documents

Everything listed here has been verified to exist. Commit `790aa7b` removed 120
legacy documents; this index went on naming 15 of them for months, so treat any
addition below as a promise to keep it true.

- `README.md` — quick start
- `devlog.md` — the running record of what changed and *why*. The most useful
  file in the repo for context on a past decision; read it before assuming
  something is arbitrary.
- `AGENTS.md` — a pointer back to this file. Deliberately thin; see the note in it.
- `src/app/api/CLAUDE.md` — **required** API route patterns (cookie auth, admin client)
- `database/MIGRATIONS.md` and `database/docs/` — migration ordering and the
  guardian reconciliation notes. SQL lives under `database/`, sorted into
  `migrations/`, `fixes/`, `features/`, `tests/` and `archive/`.
- `docs/MEDIA.md` — video posters + never-broken media (convention 43): the one video
  renderer and the codec rule, the upload queue's two chains, the blur, the worker (jobs,
  ffmpeg, the tick, the doors, the enqueue, the hygiene, the env), `processing` end to end,
  the formats and what stays out, the cost.
- `docs/WORKOUTS.md` — the workout screen (convention 42): the model (260), the one chain,
  the healed groups, the clock's rules, rest and the stopwatch, what counts where.
- `docs/TEAMS.md` — teams & divisions (convention 28): the switches, the roster
  writer and reader, the pages, the coach view, the rollover carry.
- `docs/PLAY.md` — the Play program (convention 29): badges, share cards,
  rivalries, live cheers, friend challenges; the principles and each piece's rules.
- `docs/GOLF_COURSE_DATA.md` — the golf catalog (convention 35): sources, budgets and
  attribution (Terrain Tiles, OSM), hydration outcomes, the geometry + greens shape and
  the refetch-once rule, the elevation providers' order, the probes, the unstamp runbook.
- `docs/ACTIVITIES.md` — imported AND live-recorded GPS activities (convention 30): the normalized
  shape, the FIT-SDK server-only rule, the gate and the three projections,
  Vitals, and Connected apps (mig 247: the connections table, the sealed
  tokens, the duplicate rule, the Apple Watch upload link, what each provider
  allows).
- `docs/CONNECTIONS_APPLICATIONS.md` — the provider applications Tom sends (Wahoo,
  COROS, Suunto), what each asks, the text to paste, and Polar's licence clauses.
- `docs/ROADMAP_2026-10.md` — what is decided for after the fix round: installing the
  web app on a phone, the App Store / Google Play apps (staged), and Connected apps
  (built, paused, hidden in production).
- `docs/PUSH.md` — phone notifications and the app icon's number (convention 31,
  mig 248): the sweep, the one sender, the worker, the keys, what each platform allows.
- `docs/LAUNCH_RUNBOOK.md` — the pre-launch ops checklist (DNS/email, Supabase
  auth email, OAuth enablement, device walkthrough). Console actions, not code.
- `docs/GO_LIVE_EDGEATHLETE_CA.md` — the domain cutover to `edgeathlete.ca`
  (Sep 29 2026): today's DNS (keep the M365 + Resend records), the phase order
  (Vercel domain → Supabase/Google → DNS → `NEXT_PUBLIC_APP_URL` + a build →
  Site URL → probes), rollback, and the later `.com` move.
- `docs/HARDENING.md` — the security & efficiency **stage gate**: re-run before
  each stage. Pairs with `scripts/hardening-guardrails.sh` (the `guardrails` CI
  job) and carries the Tier-2 backlog from the Aug 2026 pre-scale audit.
- `docs/RUNBOOK_BACKUP.md` — backup & restore: what Supabase's tiers give,
  the two decisions Tom owes (tier, Storage), RPO/RTO, the restore steps, the
  quarterly drill into staging (Round 1 PR 9, Sep 2026).
- `docs/MEDIA_PRIVACY_FLIP.md` — the owner-run runbook for the final step of the
  media-proxy arc: flipping the `uploads` bucket to private. Verify with
  `npm run verify:media-privacy` (`scripts/verify-media-privacy.mjs`).
- `docs/ORG_PLATFORM_MASTERPLAN.md` — the org-platform master plan. Status:
  **phases 0–6b SHIPPED** (console/claim → competition model → public org
  sites with SEO → automatic flows → registration → vanity paths/sanctioning/
  disputes/import → golf club page, builder depth, custom domains; Aug 30–
  Sep 1 2026; `DEVLOG.md` is the round-by-round record). Payments skipped by
  decision. The doc remains the design reference. Its §6 is SUPERSEDED by
  the Site Builder program (convention 12; #616–#643, Sep 9 2026 — phases
  1–11 complete; the editor is the console's door).
- `docs/` — roadmaps (`docs/ROADMAP_2026-07.md`, `docs/MULTI_SPORT_ROADMAP.md`), a
  security audit, and feature write-ups. **`docs/devlog/` is the OLD devlog** (entries
  001–010, superseded by `docs/devlog.md`) — history, not current
  state. Several files here predate late 2025; check `git log` before trusting
  a detail.
