# Edge Athlete — Strategic Assessment & Sprint Roadmap

## Context

Tom asked: what should I work on next, what are the glaring issues, where should time/effort go — broken into sprints. Parameters (from Q&A): **3+ months to launch**, first ~100 users will be **strangers/recruited**, capacity is **Tom + Claude part-time** → foundation-first roadmap, small shippable slices, stranger-grade first impressions by launch.

Baseline going in: all major surfaces just had deep bug hunts (~80 fixes, July 22) — the code that exists is *correct*; this assessment is about what's **missing, fake, or unprotected**. Three read-only surveys ran (product completeness, production readiness, golf depth). Key audit claims were spot-checked against current code (several "open" items from `docs/SECURITY_AUDIT_2026-07-17.md` were already closed by the July 22 hunts).

## The glaring issues (top-line diagnosis)

1. **Blind in production** — zero error monitoring, zero tests, zero CI. Safety net = one person running `npm run build`. You will not know prod is broken until a user emails.
2. **The core golf loop doesn't compound** — round *entry* is golfer-grade, but the round-detail page renders **hardcoded fake data** (`Math.random()` Pebble Beach), there is **no round history list**, **no trends**, and handicap is a manual string while rating/slope data sits unused. Golfers have no reason to return weekly.
3. **Account recovery doesn't exist** — no password-reset flow at all; email-verification limbo strands new signups if confirmation is on. For stranger users this is churn with no recovery.
4. **Leads are silently discarded** — 4 of 5 landing-page CTAs feed a waitlist API whose insert/email are commented out.
5. **Abusable endpoints** — the in-memory rate limiter is non-functional on Vercel serverless and covers only 3 routes; signup/upload/messages/follow are unthrottled.
6. **Cold-start kills strangers** — zero onboarding (no avatar step, no follow-suggestions, no "log your first round"), generic empty states, golf CTA buried in a multi-step modal.
7. **Trust surfaces missing** — no ToS/Privacy pages, contact API has no form page, notification-preferences UI unreachable (Settings tab is a stub), message reports written to a table nobody reads, no admin tooling.
8. **Shared rounds' social loop is silent** — full invite/attest/score/leaderboard machinery exists but creates **zero notifications**; invitees never learn they were invited.
9. **Data-layer landmines** — 86 runnable SQL scripts in `database/archive/` (one already broke prod tagging), 3 migration dirs, no way to know what's applied.
10. **Dual auth pattern** — 19 routes hand-roll cookie parsing instead of `requireAuth`; this pattern is what kept producing IDOR bugs. *(Shipped July 23, commit `6f652cd` — one shared cookie client; residual 21 hand-rolled 401 checks consolidated onto `getServerAuth` Aug 4.)*

**Strengths to preserve:** strict TS (only 8 `any`s), numbered migrations 001–026, next/image discipline, correct feed pagination, account-deletion flow, messaging/notifications stacks (post-hunts), per-post golf scorecards.

## Sprint roadmap

Sized for part-time capacity: each sprint ≈ 2 weeks of sessions, independently shippable. Order: safety net → core golf value → first impressions → trust → pre-launch hardening.

### Sprint 1 — "Eyes, locks, and recovery" (foundation quick wins)
*Goal: from blind/unguarded to monitored/gated, and no user can be permanently locked out.*
1. **Error monitoring**: Sentry (`@sentry/nextjs`) + `/api/health` endpoint. (½ day)
2. **CI gate**: add `typecheck` script; GitHub Actions running tsc + lint + build on push/PR. (½ day)
3. **Real rate limiting**: Upstash Redis (or Vercel KV) limiter replacing the in-memory `src/lib/rate-limit.ts`; apply to signup, waitlist, upload, follow, messages send, contact. (1 day)
4. **Password reset flow**: `resetPasswordForEmail` + `/reset-password` page + "Forgot password?" link on login; **email-verification UX** (post-signup guidance + resend button). (1 day)
5. **Close the last audit sliver**: `/api/upload` `temp/` path fallback (`src/app/api/upload/route.ts:40`); add HSTS + report-only CSP to `vercel.json`. (½ day)
6. **Unbounded-query caps**: pagination on `/api/comments` and `/api/followers`. (½ day)
7. **`.env.example` fixed** to list real required vars. (15 min)

### Sprint 2 — "Rounds are real" (golf history)
*Goal: a golfer can browse, view, edit and trust their round history.*
1. **Real round-detail page**: wire `/app/sport/golf/rounds/[roundId]` to `golf_rounds` + `golf_holes` (replace the Math.random() mock; API exists), implement Edit/Delete buttons. (M)
2. **Rounds list page**: `/app/sport/golf/rounds` — filterable by course/date/9-vs-18, linked from profile + sport page. (S/M)
3. **9-hole & back-9 support**: un-hardcode `holeCount`/`startingHole` in `GolfScorecardForm.tsx:52-54`; stats calc already handles partial rounds. (S)
4. **Fix the waitlist**: uncomment/implement persistence + notification email in `/api/waitlist`; capture the Club/League/Fan leads. (S)

### Sprint 3 — "The retention engine" (golf that compounds)
*Goal: the reason a golfer opens the app every week.*
1. **Trends dashboard**: scoring average, FIR%, GIR%, putts/round over time. Add one light chart lib (recharts); data already in `golf_rounds`; extend `/api/golf/stats` (trend field exists, currently hardcoded null). (M/L — the flagship item)
2. **Computed handicap**: WHS-style differentials from stored score/rating/slope (all captured today, never used); display trend on profile; keep manual override. (M)
3. **Shared-round notifications**: create notifications on invite, attest, "scores owed", round complete — hooks into existing `create_notification`; touch `group-posts`, `participants`, `attest`, `scorecards` routes. Makes the social loop actually loop. (S/M)

### Sprint 4 — "First impressions" (stranger-ready onboarding)
*Goal: a recruited stranger reaches value in their first session.*
1. **Onboarding flow** after signup: avatar prompt → follow-suggestions (ConnectionSuggestions exists) → "Log your first round" CTA. 3 skippable steps, not a gauntlet. (M)
2. **Golf-first empty states**: feed/profile empty states say "Log your first round", deep-linking into the golf composer; consider a persistent "Log Round" shortcut button. (S)
3. **Course search that works**: enable + finish ONE external provider in `golf-course-service.ts` (scaffolding exists) or seed a meaningful regional course dataset; stop randomizing yardages on manual entry. (M)
4. *(Stretch)* **Mobile quick-entry mode**: score-only hole stepper alternative to the 72-field table. (M)

### Sprint 5 — "Trust & support"
*Goal: the surfaces strangers check before investing, and the levers to run a community.*
1. **Settings → Notifications tab**: real preferences UI (allowlisted PATCH API is ready and has zero clients). (S/M)
2. **Settings → Security tab**: password change. (S)
3. **Legal + support**: ToS + Privacy Policy pages, footer links, contact form page wired to the existing `/api/contact`. (S/M)
4. **Admin-lite**: repurpose the orphaned `/dashboard` as an admin page (role-gated): message-reports queue (table exists, nothing reads it), basic user lookup. (M)
5. *(Stretch)* **Email notifications**: weekly digest or unread-activity email via existing nodemailer service. (M)

### Sprint 6 — "Hardening & housekeeping" (pre-launch)
*Goal: launch-ready engineering hygiene.*
1. **Smoke-test suite**: Playwright covering signup→login→post round→view round→message→notification; wire into CI. (L, highest-value test investment)
2. **Auth consolidation**: migrate the 19 inline `createServerClient` cookie-split routes to `requireAuth` (the pattern that kept producing IDOR bugs). (M) *(Done — July 23 `6f652cd` + Aug 4 residual pass; landed on `getServerAuth` rather than `requireAuth`, see DEVLOG.)*
3. **Input validation**: zod schemas on mutation routes, incremental. (M)
4. **Migration hygiene**: move `database/archive/` (86 scripts) out of repo or into a clearly-fenced `attic/` with a DO-NOT-RUN readme; unify the 3 migration dirs; adopt Supabase CLI migration tracking. (S/M)
5. **Dead-code sweep**: delete `/dashboard` orphan (if not reused by admin), `EnhancedGolfForm`/`CreatePostModalSteps` parallel path (verify unused first), root cruft (`clear-cache.html`, `run-sql-fix.html`); rename `"ai-starter"` package + `AI Demo App` name; rewrite README (currently Codespaces boilerplate). (S)
6. **PWA baseline**: manifest + icons + installability (no offline scope). (S)

### Explicitly deferred (post-launch)
- OAuth (email/password fine for 100 users; reset flow is the real gap)
- Sport #2 (stat-line sport is S/M when wanted; full-depth sport is L — revisit after golf retention proves out)
- Recruiting/verified-stats features (greenfield; attestation plumbing is the seed)
- Push notifications, Stories/Events/Clubs widgets (keep the honest "coming soon" stubs)

## Verification approach

- **Sprint 1**: force a test error → appears in Sentry; hit rate-limited routes past threshold → 429; full password-reset round trip on a real mailbox; CI red/green on a deliberate type error.
- **Sprint 2–3**: log 9-hole + 18-hole rounds → both appear in list + detail with correct stats; verify trends math against a hand-computed spreadsheet of the seeded rounds; shared-round invite produces a notification for the invitee (live DB check, established PostgREST pattern).
- **Sprint 4**: fresh-account walkthrough on a phone — signup → onboarded → first round posted, timed.
- **Sprint 5–6**: preferences round-trip persists; reports queue shows a filed report; Playwright suite green in CI; fresh clone + `.env.example` boots.
- **Standing pattern**: after each sprint, tsc/lint/fresh-build gate + a targeted mini bug-hunt on the new surface (the July pattern), DEVLOG entry, commit/push per feature.

## Suggested immediate next step

Sprint 1 items 1+2+7 (Sentry, CI, .env.example) are one focused session and change the risk profile of *everything else that follows* — every later sprint gets built with monitoring and a CI gate underneath it.
