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
public `/u/[handle]` page.

### B3. Security sweep (the audit's 10 categories)
1. Admin-client routes — authorization (not just authentication) before any read/write.
2. Auth pattern — `getServerAuth`/`requireAuth`, `return` the thrown Response, no hand-rolled cookies.
3. Input validation — UUID shape on id params; `.or()` inputs stripped, not escaped; upload size/type.
4. Rate limiting — auth + high-value mutation coverage (`rate-limit-core.ts`).
5. Secrets — nothing sensitive in `NEXT_PUBLIC_*`; no service-role client reachable from `'use client'`.
6. Privacy — owner ‖ public ‖ accepted-follower on every per-profile read (the vitals/workouts block).
7. Headers/CSP — `vercel.json`; note CSP is **report-only** (see backlog).
8. IDOR — every PATCH/DELETE scopes to `user.id` or re-checks ownership.
9. Storage — private media bytes vs public URLs (see backlog).
10. Route-count drift — new routes since the last recorded pass are the unreviewed band.

---

## Backlog (Tier 2) — scheduled, not yet done

Ranked, with the source finding. Fix deliberately; each is its own change.

**Security**
- ~~**Private-media signed URLs** (MEDIUM-HIGH)~~ — **DONE (Aug 2026,
  #297–#301 + bucket flip).** Same-origin authenticated media proxy
  (`/api/media/<token>`): every media response is rewritten to a proxy path,
  and the proxy re-authorizes the live viewer before streaming bytes from the
  now-**private** `uploads` bucket. The owner-run flip is executed in prod and
  verified (`npm run verify:media-privacy` green: raw `/object/public/uploads/…`
  URLs 404, proxy still serves authorized viewers). See `docs/MEDIA_PRIVACY_FLIP.md`.
- **CSP is report-only with no report-uri** (MEDIUM). Enforcing needs
  `unsafe-inline`/`unsafe-eval` removed first — its own careful project.
- Verbose Postgres error bodies in `followers` 500s; consistent UUID-400s on the
  remaining id params; group-admin can add a user who blocked them.

**Efficiency / scale**
- **Feed keyset pagination + following-scope decision.** The default feed is a
  global-public feed today (doesn't go empty), and `hasMore` is pre-filter;
  `.range(offset)` degrades on deep pages. A keyset feed RPC is the scale-tomorrow
  shape — but changing feed composition is a product decision.
- ~~**live-now double-poll**~~ — **DONE (Aug 2026, #302).** Added a count-only
  `/api/golf/live-now/count` (lean 4-column query) and pointed `useLiveNow` at
  it; the deep embed now runs only on the 3 pages that render `LiveNowStrip`,
  not on every authenticated page.
- Single-post GET/create still embed `post_likes` (bounded to one post).
- `active-sports` and `golf/stats` scan full history for a small set / two counts —
  need a distinct-keys RPC / `{count,head}`.
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
  to prevent an IDOR) assembles the list in a single call. Still **unpaginated**
  — true pagination (client infinite-scroll) remains a separate item.
- RLS `(select auth.uid())` wrapping on the golf/group policies (mig 004).
- Module-scope `supabaseAdmin` in `src/lib/supabase.ts` (imported by client files;
  key doesn't leak today, one refactor from mattering).

**Infra / ops (prerequisites & already-owed)**
- **Staging environment** (a second Supabase project + preview Vercel env) — the
  prerequisite for real synthetic load testing. Until it exists, scale review is
  analytical only (this runbook), never load tests against prod data.
- Vercel WAF rule for search GETs (DEVLOG #183, still owed).
- Resend DNS/SPF/DKIM/DMARC — every app email 550s today (`LAUNCH_RUNBOOK.md`).
- `reminders` + `notification-digest` crons are unscheduled in `vercel.json`.

---

## Change log
- **Aug 2026** — first audit + Tier-1 fixes shipped (index migration 123;
  count/limit fixes; feed like-embed removal; polling pause; security gates for
  stat-lines/organizations/tags/upload/`.or()` sanitizer). This runbook + the CI
  guardrails established. Backlog above is the remainder.
- **Aug 2026** — private-media proxy + bucket flip completed (#297–#301). Tier-2
  efficiency cluster shipped (#302–#305): live-now count endpoint, public-data
  CDN caching, digest cron batching, and the messages conversation-list RPC
  (migration 124). A default-`PUBLIC`-grant IDOR on the new RPC was caught in
  verification and closed with a `REVOKE` (service_role-only EXECUTE) — the same
  class as the 085/086 handle-takeover revokes; always test a new RPC with the
  anon key. Remaining Tier-2: CSP enforcement, the Postgres-error/IDOR security
  trio, feed keyset pagination, and the smaller efficiency + infra/ops items.
