# Launch Runbook — the five ops gates before real users

Everything in this file is a **console/dashboard action** (nothing here ships
in a PR), listed in priority order. Each section ends with a probe that proves
the gate is actually open — run the probe, not just the config.

Status legend: check the box when the probe passes, not when the setting is
saved.

---

## 0. Opening the gate — the checklist (Oct 22 2026)

Production is gated: `NEXT_PUBLIC_LAUNCH_GATE=1` in Vercel Production is
baked into the build (`src/lib/launch-gate.ts`), so every signed-out visitor
is sent to `/auth/coming-soon` except the doors (`/?signin=1`, `/auth/*`,
`/forgot-password`, `/reset-password`, `/privacy`, `/terms`, `/admin`,
static files); `/robots.txt` answers `Disallow: /`, `/sitemap.xml` 404,
`POST /api/signup` 403, and the login page shows "Sign-ups are closed".
Supabase → Authentication → "Allow new users to sign up" is OFF (it covers
Google too). APIs and the pg_cron jobs are never gated. The coming-soon page
collects names and e-mails into `contacts` (marketing consent unticked by
default) — that list is the opening announcement's audience.

**Before the switch — blocking.** Owner in brackets; every line ends in a probe.

- [ ] **E-mail** (§1 + §2) [Tom: Resend + Vercel + Supabase dashboards; Claude:
      the probe specs]. Parked since Sep 27 2026 by decision ("until we go
      public") — this is that step. Resend → Domains → `edgeathlete.ca` →
      Verify (the DNS records are in GoDaddy since Sep 29); `SMTP_HOST`,
      `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` in Vercel
      Production; Supabase custom SMTP on prod (password reset and sign-up
      confirmation use Supabase's own sender, a handful an hour otherwise);
      raise the auth e-mail rate limit. While `SMTP_*` is unset every sender
      skips quietly and the urgent / digest crons leave their rows unstamped,
      so nothing is lost — it sends once configured. Probe: the prod contact
      form lands in a real inbox; Forgot password arrives and the link opens
      `/reset-password`; a guardian invite arrives.
- [ ] **Sign-up path** [Tom]. Supabase sign-up switch ON. E-mail confirmations
      are OFF today (verified live): decide — keep OFF (the account signs in
      at once after sign-up; the `signup` bucket is 5 an hour per IP) or ON
      (needs e-mail first). `NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES=1` in
      Production so an under-age sign-up parks in `pending_profiles` with a
      guardian invite. Google sign-up human round-trip (§3). Probe: an athlete
      sign-up lands in `/onboarding`; a parent sign-up creates a PARENT.
- [ ] **The QA e-mail domain** [done Oct 22 2026, `edgeqa-<tag>@edgeathlete.ca` — the apex: Supabase checks the domain in DNS on signUp, and a record-less subdomain came back "invalid"; staging confirmations are ON with the built-in sender at 2 mails an hour, so at most two real sign-up specs pass per hour there]:
      the three real-sign-up specs (`scout-signup`, `scout-search`,
      `scout-search-performance`) guard the door again.
- [ ] **Vercel plan** [Tom, cost]. Hobby's terms are non-commercial; a public
      product runs on Pro (US$20 a month), which also unlocks Skew Protection
      (§5b) and longer function limits. Supabase is already Pro (Micro since
      Oct 19 2026).
- [ ] **Rate limits** [Tom decides, Claude one line]. `write-general` (120 a
      minute per account) has run in SHADOW since Oct 10 2026 — logged, never
      refused. Read the `[RATE-LIMIT]` lines in the Vercel logs; none fired by
      Oct 10. Decide real or shadow at launch (recommendation: real).
- [ ] **Robots, sitemap, indexing** [Tom]. Both flip with the flag:
      `src/app/robots.ts` allows `/` and disallows `/api/` and `/app/`; the
      sitemap lists `/clubs`, `/leagues`, public `/u/<handle>` profiles and
      published org pages. Still unchecked from `GO_LIVE_EDGEATHLETE_CA.md`:
      the Supabase Site URL and Google Search Console. Probe after the
      switch: `/robots.txt` allows, `/sitemap.xml` 200.
- [ ] **Legal and the visitor doors** [Tom reviews, Claude one line].
      `/privacy` and `/terms` read "Last updated: July 2026" — review the
      wording for a public launch. `/help` and `/contact` are NOT on the open
      list, so a signed-out visitor is sent to coming-soon: add them to
      `OPEN_PREFIXES` so the public has a support door (one line +
      `launch-gate.test`). No cookie banner exists and none is planned: the
      app sets first-party cookies only, disclosed on the privacy page.

**Decide before, not blocking.**

- [ ] **Feed cold load on a mid-range Android** (Oct 10 2026: LCP 5.2 s, CLS
      0.35). The Get Started card appears after its fetch and pushes the feed
      246 px. Layout decision: reserve its space from the profile we already
      hold, or render it below the scope chips. One small PR.
- [ ] **Capacity.** Micro has been clean since Oct 19 2026. Measure
      production's number once in a quiet window (Tom's OK first); the
      compute add-on only if CPU binds. The first thing to break is the
      signed-in feed's uncached per-viewer read (`docs/HARDENING.md`,
      Scaling).
- [ ] **The native app shell** (`docs/ROADMAP_2026-10.md` §2). Decision of Oct 9
      2026: before the doors open to the general public, iPhone first.
      Prerequisites on the Mac: Xcode (~20 GB), the Apple Developer Program
      (US$99 a year). Either a go-public date sets the native start, or the
      web app opens the doors alone (it installs to the home screen today).
- [ ] **Launch-day watch.** Sentry carries the environment (10 % traces, no
      PII); the latency watcher during probes; Vercel logs for 500s and
      `[RATE-LIMIT]`; Supabase Reports → RAM / SWAP; the admin console's
      Support queue (reports are tickets; suspend and ban are ticket actions).
- [ ] **The announcement.** The coming-soon contacts with marketing consent
      TRUE get the opening e-mail once e-mail is green; Admin → Contacts
      exports the CSV.

**The switch itself.** Supabase sign-up ON → remove `NEXT_PUBLIC_LAUNCH_GATE`
from Vercel Production → a REAL build (not a redeploy — the flag is inlined)
→ probes: `/` serves the landing with the sign-up column, `/robots.txt`
allows, `/sitemap.xml` 200, `POST /api/signup` no longer 403s → the
`launch-gate` spec stops applying and the signed-out prod specs (share cards,
`/u/`, org sites, landing, `stats-hub-mobile`) return to the prod probe set →
the first-hour watch → the announcement. The rule's history: DEVLOG Sep 30
2026 (the gate), Oct 22 2026 (this checklist).

## 1. Email deliverability — BLOCKING (every app email 550s today)

The app sends through Resend as an SMTP relay (`SMTP_*` vars in Vercel), but
the sending domain has never verified. Broken until fixed: **guardian
invites** (a minor signing up gets parked with no email to the parent),
**transfer verification codes**, contact form, calendar invites, digest.

**State verified Aug 23 2026 (guided ops session):** the GoDaddy zone IS now
published (`ns69/ns70.domaincontrol.com` answer; root records resolve) — the
historical "unpublished zone" blocker is gone. What's missing is purely the
four Resend records below (none resolve yet). Tom deferred adding them until
go-live; this table is exactly what Resend listed for `edgeathlete.ca`
(us-east-1), transcribed for GoDaddy's form — **GoDaddy appends
`.edgeathlete.ca` to the Name field itself**, so enter ONLY the short names:

| Type | Name        | Value | Notes |
|------|-------------|-------|-------|
| TXT  | `send`      | `v=spf1 include:amazonses.com ~all` | |
| MX   | `send`      | `feedback-smtp.us-east-1.amazonses.com` | Priority 10 |
| TXT  | `resend._domainkey` | the long `p=MIGf…` DKIM value from the Resend dashboard | ONE unbroken string |
| TXT  | `_dmarc`    | `v=DMARC1; p=none;` | |

Leave every EXISTING record alone — the root `v=spf1
include:secureserver.net -all` TXT is the Microsoft 365 mail setup and Resend
does not need it changed. TTL: GoDaddy's default (1 hour) is fine.

- [ ] GoDaddy DNS → add the four records above.
- [ ] Resend → Domains → `edgeathlete.ca` → **Verify** → status flips to
      **Verified** (usually minutes, up to an hour).
- [ ] **Probe:** submit the prod contact form (or trigger any guarded send)
      and confirm the email lands in a real inbox — check spam too.

## 2. Supabase auth email — separate sender from #1

Password reset and signup confirmation go through **Supabase's own sender**,
not the app's SMTP. Supabase's built-in sender is rate-limited to a handful of
emails per hour — fine for testing, not for 100 signups.

- [ ] Supabase Dashboard → Project → **Authentication → Emails / SMTP
      Settings**: either configure custom SMTP (can reuse the Resend
      credentials once #1 is verified) or consciously accept the built-in
      limits for the first cohort.
- [ ] Authentication → **Rate Limits**: note the email-sending limit; raise if
      custom SMTP is configured.
- [ ] **Probe:** on prod, run "Forgot password?" with a real address →
      email arrives → the reset link opens `/reset-password` in the SAME
      browser and a new password works. Also probe the signup-confirmation
      resend button if confirmations are on.

## 3. Google sign-in — config VERIFIED wired; only the human round-trip left

**Probed Aug 23 2026 (headless, signed-out prod):** "Continue with Google"
renders on the login page and clicking it lands on the real
`accounts.google.com` sign-in — which proves the Supabase provider is
enabled with valid credentials AND the redirect URI is accepted. Every
console checkbox below is therefore already done:

- [x] Google Cloud Console OAuth client (origins + redirect URI).
- [x] Supabase → Authentication → Providers → Google enabled.
- [x] `NEXT_PUBLIC_OAUTH_GOOGLE=1` in Vercel prod (buttons render).
- [ ] **Probe (the one remaining step — needs a human):** complete a Google
      signup with a throwaway account → athlete path lands in
      complete-profile/onboarding; parent path creates a PARENT profile (not
      an athlete). The `ea-signup-role` cookie does the routing.

## 4. Pre-launch device walkthrough

Run on one iPhone, one Android phone, one desktop — real hardware, prod.
Flow list: `docs/qa-test-guide.md`, plus these launch-round additions:

- [ ] Signup (athlete) → lands signed-in in onboarding (auto sign-in, PR #197).
- [ ] Header **+** from /explore, /messages, /settings → composer opens.
- [ ] Compose an **evening** round → the date field shows today, not tomorrow.
- [ ] Log 3× 18-hole rounds **with course rating + slope** (the composer now
      surfaces both under Tee Color) → Trends shows the handicap estimate.
- [ ] Backfill: open an old round → Edit → set rating/slope → save → still
      there after editing a hole score (re-mirror safety).
- [ ] A round with untracked fairways/greens shows "—", not 0/9 with ✗.
- [ ] Guardian funnel end-to-end **after #1 is green** (the invite email is
      the step that's been dark).
- [ ] **Media pipeline on the phone**: signed in, open `/app/diag/media`
      (URL only, not linked) → Upload one library photo, Take photo, Record
      video → every step logs a line; screenshot or Copy log. Any `FAILED`,
      `THREW` or `TIMEOUT` line names the broken step and decoder — read it
      before changing any camera code (DEVLOG Sep 3 2026, round 9).
- [ ] **Native camera shows a BLACK preview after the shutter** (iOS's own
      screen, "Use Photo" hands nothing back): that is iOS, not the app
      (DEVLOG round 10). Device checks first — another site's photo input,
      Settings → Camera → Formats → Most Compatible, reboot, browser camera
      permission. (The composer's "Camera not working?" in-app camera link
      was removed Oct 17 2026 — the failure was one device.)
- [ ] **Capture v2 (Sep 3 2026)**: from the composer, Take photo → the tile
      appears at once (no editor); Record video 10s → tile at once → Create
      Post → the feed plays it; tap a tile's pencil → editor → Done. A video
      over 3 minutes shows "Too long — trim in the editor". The stored video
      carries no ©xyz (server scrub — the diag page's Upload line says
      `server scrub: yes`).

## 5a. Org custom domains (phase 6b C1) — the platform env + the recipe

Orgs can point THEIR domain (kmha.ca) at their Edge Athlete site from the
console (Website → Custom domain). The flow is claim → TXT verify → Vercel
attach → reachability check → live. The attach/detach steps need three
server-only env vars in Vercel (a redeploy suffices; no build):

- `VERCEL_API_TOKEN` — a token scoped to the team (Account → Tokens)
- `VERCEL_TEAM_ID` — `team_YCHm8MTPTQxzmyaTTRVoMqlU` (from `.vercel/project.json`)
- `VERCEL_PROJECT_ID` — `prj_ypEuQssAysbZQO68InlkjDZa6tIn`

Until they are set, a verified domain parks as "verified — awaiting
platform" and the admin dashboard's **Custom domains** list offers *Retry
connect* once the env lands. The org's DNS side is prescribed in the
console: `TXT _edgeathlete.<domain>` = the token, plus `CNAME <domain> →
cname.vercel-dns.com` (apex domains: `A 76.76.21.21`). Serving on the
custom host and the apex 301 are gated by **`CUSTOM_DOMAINS=1`** — read in
the Edge middleware, so it is BUILD-INJECTED (a real build, not a redeploy;
the ORG_SUBDOMAINS precedent). Test hostname for the prod probe: a Tom-controlled domain **other than** `edgeathlete.ca` — once the apex is `edgeathlete.ca`, `isReservedDomain` refuses every `*.edgeathlete.ca` host (GO_LIVE_EDGEATHLETE_CA.md, Parked).
Rollback = unset the flag + build; claimed domains simply stop routing
(the apex address always works).

## 5b. Vercel Skew Protection — one toggle (Round 1 PR 8, Sep 21 2026)

Every deploy replaces every hashed chunk. A phone with the app open
across a deploy fails its next lazy import (`ChunkLoadError` / "Importing
a module script failed") and used to land on "Something went wrong" with a
"Try again" that could not help. The app now recognises that error and
reloads once (`src/lib/version-skew.ts`, the `(app)` error boundary) —
that is the floor. The real fix is Vercel's, and it is a setting, not code
(Next ≥ 14.1.4 needs no `next.config` change; projects created after
Nov 19 2024 have it on by default — this one predates that):

1. Project → **Settings → Environment Variables → "Automatically expose
   System Environment Variables"** must be on.
2. **Settings → Advanced → Skew Protection** → enable; leave Maximum Age
   at the default (1 day).
3. **Redeploy** the latest production deployment.

Pro / Enterprise only. On Hobby the toggle is absent and the reload-once
floor is what runs. Verify: Monitoring → `requests` filtered
`skew_protection = 'active'` after the next deploy.

## 6. Vercel environments → staging (Round 2, Sep 21 2026) — three clicks

Preview and Development deployments must read the STAGING Supabase
project; only Production reads prod. **DONE Sep 21 2026** by
`node scripts/vercel-preview-env.mjs` (idempotent: narrows the prod
entries to Production, adds Preview + Development entries from
`.env.local`, fresh random `MEDIA_PROXY_SECRET` / `ANALYTICS_SALT` for
previews; `--dry-run` reports only; never prints a value). Re-run it after
rotating a staging key. The manual steps below are the same change by hand.

1. Vercel → edge-athlete → **Settings → Environment Variables**. For each
   of `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`: edit the existing entry → untick
   **Preview** and **Development**, keep **Production** → Save.
2. Add each of the three again with the STAGING value (from `.env.local`),
   ticking **Preview** and **Development** only. Mark the service key
   Sensitive.
3. Add `MEDIA_PROXY_SECRET` and `ANALYTICS_SALT` for Preview + Development
   with any fresh random string (they exist for Production only today;
   previews need their own, never prod's).
4. GitHub → repo → **Settings → Secrets and variables → Actions**: replace
   the three Supabase secrets with STAGING's values (the smoke job refuses
   prod by design once #868 is in).
5. Then merge the PR that turns previews on (`vercel.json`
   `git.deploymentEnabled` for `feat/**` and `fix/**`) — NOT before: a
   preview built with prod's keys would run the app against prod.

Verify: open any preview → sign up → the user appears in the STAGING
project's Authentication list, not prod's.

## 5. Custom domain — see `docs/GO_LIVE_EDGEATHLETE_CA.md`

**Sep 29 2026:** the full cutover checklist for `edgeathlete.ca` (every host dependency in the code, today's DNS, the phase order, the probes, rollback, and the later `.com` move) is `docs/GO_LIVE_EDGEATHLETE_CA.md`. The history below is kept for context.

### History (Aug 23 / Sep 1 2026)

Sep 1 note: §5a (above, on purpose — the platform env comes first) makes
this apex load-bearing for TESTING org custom domains: the C2 prod probe
uses a Tom-controlled subdomain of `edgeathlete.ca` as its test Host.

Found Aug 23: `edgeathlete.ca`'s root A records are GoDaddy forwarding IPs —
the app lives only at `edge-athlete.vercel.app`. This is NOT a launch gate,
but it is a decision: either consciously launch on the vercel.app URL, or
point the domain at Vercel BEFORE launch (Vercel → Project → Domains → add
`edgeathlete.ca` + `www`, set the records Vercel prescribes in GoDaddy, THEN
extend Supabase URL Configuration + the Google OAuth client origins with the
new domain). Half-doing this is the only dangerous option — OAuth redirects
and auth emails break if the domain flips without the config following.

---

*Everything else previously suspected as a launch gap was verified handled in
code (password reset, empty-feed experience, health/Sentry/CI/rate limiting,
PWA baseline). `docs/ROADMAP_2026-07.md` is historical — don't launch-plan
from it.*
