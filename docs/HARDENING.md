# Hardening Runbook — Security & Efficiency Stage Gate

The standing process for keeping Edge Athlete secure and efficient as it scales.
Modeled on `docs/LAUNCH_RUNBOOK.md`: **re-run this before each stage** (next
sport, orgs/multi-tenant, recruiting, and before any large user-growth push).

Two layers enforce it:
1. **CI guardrails** (`scripts/hardening-guardrails.sh`, run by the `guardrails`
   job on every PR) — cheap, automatic, catch the known regressions.
2. **This runbook** — the periodic human sweep for design-level issues CI can't see.

First established Aug 2026 by a three-part pre-scale audit (efficiency, security,
DB scale-readiness). That audit's findings seed the backlog below.

---

## Part A — automated, every PR (already wired)

- `npm run verify` — typecheck, lint (0 warnings), tests, build.
- `guardrails` job → `scripts/hardening-guardrails.sh`:
  - **hard-fails** on: backslash `.or()` sanitizer (use the strip approach,
    cf. `course-catalog.ts` `likeSafe`); `instanceof Response) throw` in a route
    (must be `return` — a thrown Response is a 500 under Next 16.3); `await
    cookies()` / `next/headers` in a route outside the auth exceptions; `npm
    audit` high/critical.
  - **advisories** (printed, non-blocking): count-by-fetch `.select('id'|'*')`
    sites; interpolated `.or()/.filter()` sites.
  - Escape hatch: a `hardening-ok` comment on a line exempts a deliberate case.

## Part B — periodic manual sweep (this runbook)

### B1. Live index state (DB scale)
The migrations are **not** the source of truth for the hottest tables (`follows`,
`posts`, `post_likes`, `post_comments`, `post_media` were created by archived
scripts). Confirm index reality directly, in the Supabase SQL editor:
```sql
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname='public'
  AND tablename IN ('follows','posts','post_likes','post_comments',
                    'post_media','notifications')
ORDER BY tablename, indexname;
-- Index usage over time (run after a few days of real traffic):
SELECT relname, indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes WHERE schemaname='public' ORDER BY idx_scan DESC;
```
Migration 123 added the hot-path indexes (`IF NOT EXISTS`, idempotent). Any NEW
index on a now-large table must use `CREATE INDEX CONCURRENTLY` (outside a txn).

### B2. Query-cost review (efficiency)
For each hot surface, count awaited DB round-trips per request and check for the
recurring anti-patterns:
- **count-by-fetch** → `{ count:'exact', head:true }`, never `.select().length`.
- **unbounded reads** on growth tables → always `.limit()`/`.range()` (PostgREST
  silently caps at 1000 and drops rows).
- **unbounded embeds** → e.g. never embed a full `post_likes` list to answer "did
  *I* like this" (batch a viewer-scoped query instead — the feed pattern).
- **`.in(<ids>)`** built from an unbounded fetch → cap it, or use an RPC/join.
- **polling** → pause on `document.hidden`; don't fire duplicate polls of one endpoint.

Hot surfaces to walk: feed load (`/api/posts`), profile load, vitals tab,
messages/notifications providers (root-layout polls), search keystrokes, the
public `/u/[handle]` page, **the public org-site tree (`/org/{slug}` + its
subpages — ISR + per-module `unstable_cache` readers; DB cost appears only
on cache fill, so walk the readers in `src/lib/org-sites/public-data.ts`)**,
and the sitemap enumerator (`fetchPublishedSitesForSitemap` — the repo's one
whole-table `org_sites` scan; keep it bounded and hourly-cached).

### B3. Security sweep (the audit's 10 categories)
1. Admin-client routes — authorization (not just authentication) before any read/write.
2. Auth pattern — `getServerAuth`/`requireAuth`, `return` the thrown Response, no hand-rolled cookies.
3. Input validation — UUID shape on id params; `.or()` inputs stripped, not escaped; upload size/type.
4. Rate limiting — auth + high-value mutation coverage (`rate-limit-core.ts`).
5. Secrets — nothing sensitive in `NEXT_PUBLIC_*`; no service-role client reachable from `'use client'`.
6. Privacy — owner ‖ public ‖ accepted-follower on every per-profile read (the vitals/workouts block).
7. Headers/CSP — non-CSP headers in `vercel.json`; **CSP is ENFORCED and
   middleware-owned** (nonce per request, `src/lib/csp.ts`; `CSP_ENFORCE=0`
   = report-only rollback; violations land at `/api/csp-report`).
8. IDOR — every PATCH/DELETE scopes to `user.id` or re-checks ownership.
9. Storage — private media bytes vs public URLs (see backlog).
10. Route-count drift — new routes since the last recorded pass are the unreviewed band.

### B4. Anonymous-surface sweep (phase 3 — the public org sites)
The (public) segment serves ANONYMOUS, CDN-cached documents; its invariants
are different in kind from the app's and each one is load-bearing:
1. **Viewer independence** — nothing under `src/lib/org-sites/` may branch on
   a session; one cached render serves everyone (the standings contract).
2. **Never-throw readers** — a throw inside `unstable_cache` 500s the page;
   every reader degrades to empty (`isMissingTableError` + `'42703'`).
3. **The ISR contract** — every page under `(public)` exports
   `revalidate` AND `generateStaticParams` (empty ok); a missing export is
   silent permanent-MISS SSR (measured). Probe: the x-vercel-cache ladder.
4. **Name masking** — `publicDisplayName` (full name only for claimed public
   profiles, else "First L.") at EVERY person-rendering call site; email is
   selected only to feed it and never leaves a return type.
5. **Streamer prefix asserts** — the tokenless org-logo/org-media streamers
   serve ONLY server-built keys under their fixed prefixes; their
   `api-route-authz` allowlist justifications must stay true word for word.
6. **JSON-LD carries NO Person, ever** — minors are never indexed; people
   stay out of structured data entirely (masterplan §SEO).
7. **Crawler files** (`/robots.txt`, `/sitemap.xml`) ride the middleware
   static branch — they must never pay the auth round trip.
8. **Accent hygiene** — theme accents validated at write (strict hex +
   the luminance clamp) AND re-validated at render before any inline style.
The guardrails script enforces the mechanical half (no `'use client'`,
`next/headers`, or Font Awesome under `(public)`; `next/og` isolation);
this sweep covers the rest by reading.

---

## Backlog (Tier 2) — scheduled, not yet done

**From the Sep 2026 phase-3 R5 close (public-segment perf, accepted for now)**
- **Shared `globals.css` (~40KB) ships whole to the public tree** — the org
  pages use a small subset but pay for the full app design system (incl.
  inert dark tokens). A split entry is the fix; measure before bothering.
- **Proxied images are `unoptimized` by rule** (`/api/media/*` is not
  optimizer-eligible) — logo + page images skip webp/avif and resizing.
- **Page-image CLS** — block images store no intrinsic dimensions
  (`h-auto w-full` governs); storing width/height at upload would fix it.

Ranked, with the source finding. Fix deliberately; each is its own change.

**From the Sep 2026 pre-phase-3 stage-gate sweep (org/competition band)**
- **`.limit()` sweep, remaining sites** — `structureAggregateGET` (4
  selects), `structure-options` (2), `competitionDetailGET`
  contests/participants/results/standings, `recomputeStandings` entries
  read. (The two hottest aggregates' entry reads were capped fix-now.)
- **`competitionDetailGET` redundant competition re-select** — merge
  `pinCompetition` + the `full` re-select into one read.
- **Roster import worst case** — 50 rows × ~6 sequential admin ops (+
  optional SMTP) in one request; a timeout loses the report while stubs
  were already minted. Lower cap or chunked responses.
- **`athlete-claim` POST body onto zod** (hand-rolled email/password
  checks today); score range bounds in `ResultUpsertSchema`.
- **`resultsUpsertPOST` auto-complete count-by-fetch** →
  `{ count:'exact', head:true }` (bounded ≤50 today; advisory).
- Sweep verdict otherwise: scope-pin coverage, token lifecycle, rate
  buckets, error bodies, twins all verified clean; fix-nows shipped
  (public-name masking per masterplan §6, SSR standings React cache(),
  hot-aggregate limits).

**Security**
- ~~**Private-media signed URLs** (MEDIUM-HIGH)~~ — **DONE (Aug 2026,
  #297–#301 + bucket flip).** Same-origin authenticated media proxy
  (`/api/media/<token>`): every media response is rewritten to a proxy path,
  and the proxy re-authorizes the live viewer before streaming bytes from the
  now-**private** `uploads` bucket. The owner-run flip is executed in prod and
  verified (`npm run verify:media-privacy` green: raw `/object/public/uploads/…`
  URLs 404, proxy still serves authorized viewers). See `docs/MEDIA_PRIVACY_FLIP.md`.
- ~~**CSP is report-only with no report-uri**~~ — **DONE (Aug 2026, #320).**
  ENFORCED, nonce-based, owned by the middleware (per-request nonce; Next
  auto-nonces its inline scripts from the request CSP header; `unsafe-eval`
  gone in prod). `/api/csp-report` sink + `Reporting-Endpoints`; `CSP_ENFORCE=0`
  env = report-only rollback. Cost: `headers()` in the root layout makes every
  page dynamic (deliberate, documented in the PR). Dev stays report-only.
- ~~Verbose Postgres error bodies; UUID-400 consistency; blocked-user group
  adds~~ — **DONE (Aug 2026, #316 + #317).** ~40 leak sites sanitized
  (friendly string to the client, raw to console/Sentry) + a guardrail
  advisory; canonical `src/lib/uuid.ts` + ~45 routes now 400 on malformed ids;
  group adds silently skip blocked users via the shared
  `filterBlockedBidirectional` (`src/lib/blocks.ts`) — count-only responses,
  post_tags propagation fixed, new group-post rate buckets. The flagged
  follow-up landed later the same day (Tom's product call): blocks now gate
  follow (403 create-only; block creation severs existing edges both ways),
  tagging (silent skip on posts create/edit + the tags endpoint), and
  connection suggestions.

**Efficiency / scale**
- ~~**Feed keyset pagination**~~ — **DONE (Aug 2026, #319 + migration 126's
  index).** Additive `?cursor=` contract ((created_at,id) keyset, overfetch
  hasMore, nextCursor past privacy-filtered rows); legacy offset path intact.
  The following-scope lens landed later the same day (Tom's call):
  `?scope=following` mirrors the org lens (accepted follows ∪ self, capped
  2000, `noFollowing` envelope) with NO SQL visibility restriction — the
  per-post privacy filter grants accepted-follower access to private posts,
  which is the lens's point. The global-public default feed is unchanged.
- ~~**live-now double-poll**~~ — **DONE (Aug 2026, #302).** Added a count-only
  `/api/golf/live-now/count` (lean 4-column query) and pointed `useLiveNow` at
  it; the deep embed now runs only on the 3 pages that render `LiveNowStrip`,
  not on every authenticated page.
- ~~Single-post like-embed; active-sports/golf-stats scans~~ — **DONE
  (Aug 2026, #318 + migration 126).** Viewer-scoped like lookup (wire shape
  identical); distinct-keys RPCs (service_role-only); golf/stats `?year=`
  filters in SQL (also fixes silent corruption past the 1000-row cap for
  year-scoped requests — the NO-year all-time aggregate can still cap past
  1000 rounds, flagged residual); GolfAdapter promise-cache collapses the
  profile page's 3 stats fetches to 1.
- ~~Public-data caching~~ — **DONE (Aug 2026, #303).** `Cache-Control` on
  `/api/public/profile`, `/api/explore`, `/api/golf/courses/facets` (all CDN
  `HIT` in prod), and `/api/golf/courses` (auth-branched: `private,no-store`
  when authed / `public,s-maxage`+`Vary:Cookie` when anon).
- ~~`digest-server.ts` sequential 200-user cron will time out~~ — **DONE
  (Aug 2026, #304).** Batched (`chunk` of 10 + `Promise.all`, batches
  sequential); the legacy unscheduled `/api/cron/notification-digest` copy was
  collapsed into the shared lib.
- ~~Messages conversation-list is `O(2N)` queries~~ — **DONE (Aug 2026, #305 +
  migration 124).** One `get_conversation_list(p_user_id)` RPC (service_role-only
  to prevent an IDOR) assembles the list in a single call. Pagination **DONE
  (Aug 2026, #321 + migration 127)**: defaulted `p_limit`/`p_before` params
  (skew-safe), route `?limit&cursor` → `has_more`/`next_cursor`, sentinel
  infinite-scroll in ConversationList; the 30s poll refreshes page one and
  merges by id. Nuance (accepted): the client search box filters LOADED pages
  only.
- ~~RLS `(select auth.uid())` wrapping~~ — **DONE (migration 126):** the 15
  surviving bare policies from 004/062 recreated byte-equivalent with the
  initplan wrapping (035/063-superseded policies untouched).
- ~~Module-scope `supabaseAdmin`~~ — **DONE (Aug 2026, #318):** export deleted;
  6 routes + `src/lib/privacy.ts` on the lazy `getSupabaseAdmin()` factory.

**Infra / ops (prerequisites & already-owed)**
- **Staging environment** (a second Supabase project + preview Vercel env) — the
  prerequisite for real synthetic load testing. Until it exists, scale review is
  analytical only (this runbook), never load tests against prod data.
- Vercel WAF rule for search GETs (DEVLOG #183, still owed).
- Resend DNS/SPF/DKIM/DMARC — every app email 550s today (`LAUNCH_RUNBOOK.md`).
- ~~`reminders` cron "unscheduled"~~ — **stale note, corrected Aug 2026:** it
  is invoked every 10 minutes by Supabase **pg_cron** (migration 059:85-92),
  with `/api/cron/daily` as the idempotent safety net; `vercel.json` holds only
  2 crons by Hobby-plan limit. `notification-digest` is deliberately a manual
  entry point (its logic runs inside `daily`, #304).

---

## Change log
- **Sep 2026 (phase-3 R5 anon-surface update)** — the public org-site
  tree becomes a first-class hardening surface: B2 hot-surfaces gains the
  /org ISR tree + the sitemap enumerator, new B4 codifies the eight
  anonymous-surface invariants (viewer independence, never-throw readers,
  the ISR contract, publicDisplayName masking, streamer prefix asserts,
  the no-Person JSON-LD rule, crawler-file fast path, accent hygiene),
  and the guardrails script grows public-segment checks (HARD: no
  'use client'/next-headers/Font Awesome under (public), next/og isolated
  to the card routes; ADVISORY: dark: utilities there). Three accepted
  perf limits filed to Tier 2.
- **Sep 2026 (pre-phase-3 stage gate, #444–#446)** — the full re-run before
  the public-sites stage. Part A automated: verify green (2379 tests), audit
  0, guardrails FIXED (the script had never learned the athlete-claim
  cookies exception — CI red since #422) + green. Part B: the B2+B3 sweep
  over the entire phase-1/2 org/competition route band came back
  structurally clean (scope-pin coverage on all four org-column-less child
  tables, token lifecycle, buckets, twins diff-identical); three fix-nows
  shipped in #446 (public-name masking per masterplan §6, SSR standings
  React cache() dedupe, hot-aggregate limits); Tier-2 remainder filed
  above. B1 live-index review: hot paths all served (places/follows/golf/
  notifications/posts); org tables' indexes grid-asserted at creation and
  correctly absent from the young-table usage tail; one no-action
  observation — idx_places_population reads ~6.8k tuples/scan (bounded
  reference data, capped routes).
- **Aug 2026** — first audit + Tier-1 fixes shipped (index migration 123;
  count/limit fixes; feed like-embed removal; polling pause; security gates for
  stat-lines/organizations/tags/upload/`.or()` sanitizer). This runbook + the CI
  guardrails established. Backlog above is the remainder.
- **Aug 2026 (hardening round, #316–#321 + migrations 126/127)** — error-body
  sanitization + UUID-400 sweep (+ guardrail advisory); blocked-user group-add
  gate (silent skip) + group rate buckets; efficiency RPCs, like-embed swap,
  golf/stats SQL scoping + client dedupe, lazy admin client, RLS initplan
  wrapping; feed keyset pagination; CSP nonce ENFORCEMENT (kill switch
  `CSP_ENFORCE=0`); conversation-list pagination. NOT done this round: blocks
  on follow/tags (product), following-scope feed (product), staging env, WAF
  search rule, Resend DNS (ops), conversation search beyond loaded pages,
  no-year golf aggregate >1000-row residual.
- **Aug 2026** — private-media proxy + bucket flip completed (#297–#301). Tier-2
  efficiency cluster shipped (#302–#305): live-now count endpoint, public-data
  CDN caching, digest cron batching, and the messages conversation-list RPC
  (migration 124). A default-`PUBLIC`-grant IDOR on the new RPC was caught in
  verification and closed with a `REVOKE` (service_role-only EXECUTE) — the same
  class as the 085/086 handle-takeover revokes; always test a new RPC with the
  anon key. Remaining Tier-2: CSP enforcement, the Postgres-error/IDOR security
  trio, feed keyset pagination, and the smaller efficiency + infra/ops items.
