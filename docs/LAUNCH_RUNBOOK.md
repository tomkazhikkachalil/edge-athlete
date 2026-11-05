# Launch Runbook — the five ops gates before real users

Everything in this file is a **console/dashboard action** (nothing here ships
in a PR), listed in priority order. Each section ends with a probe that proves
the gate is actually open — run the probe, not just the config.

Status legend: check the box when the probe passes, not when the setting is
saved.

---

## 0. Opening the gate — the checklist (Oct 22 2026)

**Run `npm run launch:probe` first (Nov 2 2026).** It reads the live state
behind every line below — the Supabase auth config (Site URL, confirmations,
SMTP, rate limit, the sign-up switch, Google), the NAMES of Vercel's
Production env (never a value), the live site (health, the gate, the doors,
push) and Resend's domain when `RESEND_API_KEY` is in `.env.staging` — and
prints each as ✓ ✗ ? – with the evidence, then the next step in this order
(`–` is a line settled by decision — printed, never the next step).
GET requests only (the one POST is the sign-up refusal the gate answers);
`--open` judges the opened state after the switch; `--json` for the devlog.
A `?` means it could not read that source (the line says which token to add).

Production is gated: `NEXT_PUBLIC_LAUNCH_GATE=1` in Vercel Production is
baked into the build (`src/lib/launch-gate.ts`), so every signed-out visitor
is sent to `/auth/coming-soon` except the doors (`/?signin=1`, `/auth/*`,
`/forgot-password`, `/reset-password`, `/privacy`, `/terms`, `/admin`,
static files); `/robots.txt` answers `Disallow: /`, `/sitemap.xml` 404,
`POST /api/signup` 403, and the login page shows "Sign-ups are closed".
The gate carries the way back (Oct 28 2026): a signed-out visit to an app
path lands on `/auth/coming-soon?next=<that path>` and the page's sign-in
link goes to `/?signin=1&next=…`, so an existing account that opened a
workout or profile link comes back to it after signing in.
Supabase → Authentication → "Allow new users to sign up" stays ON while
gated (Tom's decision, Nov 3 2026): the app's gate is the refusal, the
dashboard switch is the switch day's, and a Google sign-in through Supabase
while gated — the one way in the gate does not cover — is accepted. The
probe prints that row as `–`. APIs and the pg_cron jobs are never gated. The coming-soon page
collects names and e-mails into `contacts` (marketing consent unticked by
default) — that list is the opening announcement's audience.

### 0a. The walkthrough — Tom's steps in the probe's order (Nov 3 2026)

Each step ends with `npm run launch:probe`; the row named turns ✓ and the
probe's last line names the next step. The same list, tickable, is the
"Edge Athlete Launch Walkthrough" page.

**Where it stands (Nov 3 2026, the probe 19 ✓ of 21):** steps 1–5, 7–9 and
12 DONE; 6 settled by decision (sign-ups stay ON while gated); 10 later
(Tom); 11 open (the drill); 13 is the switch day's. Still owed by hand: the
Forgot-password round-trip (step 4), the contact form landing (step 7),
the backups confirmation + the drill (step 11).

1. **A Vercel token for the probe.** `vercel login` (the CLI's token has
   expired) — or vercel.com/account/tokens → a token scoped to the team →
   `.env.staging` as `VERCEL_API_TOKEN=`. The seven "Vercel not read" rows
   resolve.
2. **Resend.** Domains → `edgeathlete.ca` → Verify (the records are live).
   API Keys → Create → Sending access for `edgeathlete.ca` → copy the `re_`
   key once (steps 3 and 7). Optional: a Full-access key as
   `RESEND_API_KEY=` in `.env.staging` so the probe reads the domain.
3. **Supabase → Authentication → Emails → SMTP Settings:** Enable Custom
   SMTP — sender `no-reply@edgeathlete.ca`, name Edge Athlete, host
   `smtp.resend.com`, port `465`, user `resend`, password the `re_` key.
   Then **Rate Limits** → e-mails sent `60`/h. Rows: auth-smtp, auth-rate.
4. **Authentication → URL Configuration → Site URL** `https://edgeathlete.ca`
   (it is `http://localhost:3000`). Row: site-url. Human check: Forgot
   password with a real address → the mail → `/reset-password` on the domain.
5. **Authentication → Emails → Templates → Confirm sign up:** the body in §2
   below (the token-hash link). Confirmations are already ON here.
6. **Authentication → Sign In / Providers → User Signups → "Allow new users
   to sign up"** — DECIDED Nov 3 2026: it stays ON while gated (the app's
   gate answers 403; a Google sign-in through Supabase is accepted). Row:
   signups, printed `–`.
7. **Vercel → Settings → Environment Variables, Production only:**
   `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_USER=resend`,
   `SMTP_PASS=<the re_ key, Sensitive>`, `EMAIL_FROM=Edge Athlete
   <no-reply@edgeathlete.ca>`, `CONTACT_EMAIL=<the inbox>` → Redeploy. Rows:
   smtp, contact-email. Human check: the contact form lands.
8. **Vercel → Settings → Advanced → Skew Protection ON** (+ "Automatically
   expose System Environment Variables") → Redeploy (§5b).
9. **UptimeRobot:** a Keyword monitor on `https://edgeathlete.ca/api/health`,
   keyword `"status":"ok"`, alert when not found, to the phone; prove it once
   by changing the keyword, then restore.
10. **Sentry → Alerts** (later — Tom, Nov 3 2026): "New issue in production" (a new issue is created,
    environment production → notify) and "Limiter would-block" (the event's
    message contains `[RATE-LIMIT] would-block` → notify — the read behind
    the limiter flip).
11. **Supabase → Database → Backups:** daily present (Pro, 7 days) → the
    date into `RUNBOOK_BACKUP.md` §1; PITR stays off (Decision A); the
    organisation owner e-mail is one you read (Supabase's resource alerts
    go there). The drill once: `TARGET_ENV=prod node
    scripts/prod-reset/export.mjs` → `node
    scripts/prod-reset/restore-to-staging.mjs <snapshot>` → `npm run
    check:schema` → a signed-in look at staging; a dated line in the drill box.
12. **Read PR #1389** (privacy + terms) → "merge" or the sentences to change.
    DONE Nov 3 2026: merged as `e96bdcd1`, "Last updated: November 2026" live.
13. **At the switch:** sign-ups ON, the Google round-trip (athlete →
    onboarding; parent → add-athlete), then "The switch" below.

**Before the switch — blocking.** Owner in brackets; every line ends in a probe.

- [x] **E-mail** (§1 + §2) [DONE Nov 3 2026 by the probe: Supabase auth
      mail on `smtp.resend.com` (sender `no-reply@edgeathlete.ca`), 60/h,
      `SMTP_*` + `EMAIL_FROM` + `CONTACT_EMAIL` in Vercel Production; the
      three human probes at the end of this line are still owed]. Parked
      since Sep 27 2026 by decision ("until we go public") — this was that step. Resend → Domains → `edgeathlete.ca` →
      Verify (the DNS records are in GoDaddy since Sep 29); `SMTP_HOST`,
      `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` in Vercel
      Production; Supabase custom SMTP on prod (password reset and sign-up
      confirmation use Supabase's own sender, a handful an hour otherwise);
      raise the auth e-mail rate limit. While `SMTP_*` is unset every sender
      skips quietly and the urgent / digest crons leave their rows unstamped,
      so nothing is lost — it sends once configured. Probe: the prod contact
      form lands in a real inbox; Forgot password arrives and the link opens
      `/reset-password`; a guardian invite arrives.
- [ ] **Sign-up path** [Tom]. Supabase sign-up switch is ON and stays on
      while gated (decision, Nov 3 2026). E-mail confirmations are ON
      (Tom's decision Nov 2 2026; Convention 56 — the probe reads
      `mailer_autoconfirm false`, the template carries the token-hash link
      since Nov 3). `NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES=1` is in
      Production (the probe reads it) so an under-age sign-up parks in
      `pending_profiles` with a guardian invite. Left for the switch day:
      the Google sign-up human round-trip (§3). Probe: an athlete sign-up
      lands in `/onboarding`; a parent sign-up creates a PARENT.
- [x] **The QA e-mail domain** [done Oct 22 2026, `edgeqa-<tag>@edgeathlete.ca` — the apex: Supabase checks the domain in DNS on signUp, and a record-less subdomain came back "invalid"; staging's auth used to confirm by e-mail with the built-in sender at 2 mails an hour, so at most two real sign-up specs passed per hour there — **staging, and only staging, auto-confirms since Oct 22 2026** (Tom's call; management API `mailer_autoconfirm: true`, the prod ref refused by the script), mirroring production, where confirmations are off]:
      the three real-sign-up specs (`scout-signup`, `scout-search`,
      `scout-search-performance`) guard the door again.
- [x] **Vercel plan** [done: the project is on **Pro** since Oct 2026 —
      corrected Oct 25 in `SCALE_AUDIT.md` §1; this line said Hobby until
      Nov 2]. Pro unlocks Skew Protection (§5b — still a toggle to flip) and
      the longer function limits. Supabase is Pro (Micro since Oct 19 2026).
- [ ] **Rate limits** [Tom reads, Claude one line]. `write-general` (120 a
      minute per account) runs INLINE and in SHADOW since Oct 22 2026, every
      would-block recorded in Sentry by account and route (the Vercel console
      line lasts an hour; Sentry keeps the answer). After a few days of normal
      use: Sentry → Issues → `[RATE-LIMIT] would-block` → the `account` and
      `route` tag breakdown. Nobody legitimate near it → the one-line flip
      (`shadow: false`); someone near it → raise that action's bucket first.
      If launch is under a few days away: enforce at once at ~300 a minute.
- [ ] **Robots, sitemap, indexing** [Tom]. Both flip with the flag:
      `src/app/robots.ts` allows `/` and disallows `/api/` and `/app/`; the
      sitemap lists `/clubs`, `/leagues`, public `/u/<handle>` profiles and
      published org pages. Still unchecked from `GO_LIVE_EDGEATHLETE_CA.md`:
      the Supabase Site URL and Google Search Console. Probe after the
      switch: `/robots.txt` allows, `/sitemap.xml` 200.
- [x] **Legal** [DONE Nov 3 2026: Tom read #1389, merged as `e96bdcd1`;
      both pages read "Last updated: November 2026" and name every
      processor]. `/privacy` and `/terms` read "Last updated: July 2026"; since then the app added the weather at the course
      (Open-Meteo), the golf course provider lookup, web push, the Sentry
      relay and the coming-soon contacts list — review the wording for a
      public launch and move the date. No cookie banner exists and none is
      planned: the app sets first-party cookies only, disclosed on the
      privacy page. The visitor doors are DONE (Nov 2 2026): `/help` and
      `/contact` are on the gate's open list, so the public has a support
      door whether or not the gate is up (`launch-gate.test`, the
      `launch-gate` spec).

**Decide before, not blocking.**

- [x] **Feed cold load on a mid-range Android** (Oct 10 2026: LCP 5.2 s, CLS
      0.35; the Get Started card appeared after its fetch and pushed the feed
      246 px). DONE Oct 22 2026 (#1273): the card decides before its first
      paint from what the client holds and keeps its painted height as a
      floor; the Live Now strip moved below the cards Oct 28 (#1345). Owed:
      one cold measurement on a real mid-range Android after the switch.
- [x] **Capacity.** Micro has been clean since Oct 19 2026. MEASURED Nov 4
      2026 (Tom's OK Nov 3): the feed on the floor's setup — p95 448 ms at
      25 workers, 622 at 50, 0 errors (`docs/load/2026-11-04/`); production
      with no load: first post 3.5 s on a ×4-throttled phone, 1 passed. The
      viewer-independent feed page is NOT built (under the 1 s line); the
      compute add-on only if CPU binds. The first thing to break is the
      signed-in feed's uncached per-viewer read (`docs/HARDENING.md`,
      Scaling).
- [ ] **The native app shell** (`docs/ROADMAP_2026-10.md` §2). Decision of Oct 9
      2026: before the doors open to the general public, iPhone first.
      Prerequisites on the Mac: Xcode (~20 GB), the Apple Developer Program
      (US$99 a year). Either a go-public date sets the native start, or the
      web app opens the doors alone (it installs to the home screen today).
- [ ] **Push keys** [Tom]. `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
      `VAPID_SUBJECT` in Vercel Production (`docs/PUSH.md`; they are in
      `.env.example` since Nov 2 2026). Unset, push is silently OFF — the
      bell's push row hides and nothing is sent. Probe: signed in,
      `GET /api/push/config` answers `ready: true`; a real banner on a real
      phone.
- [ ] **Something that pages someone** [Tom, three dashboards; (1) DONE Nov 3
      2026 — UptimeRobot on `/api/health`; (2) Sentry later; (3) Supabase
      open]. (1) A hosted uptime monitor (UptimeRobot or Better
      Stack, free tier) on `https://edgeathlete.ca/api/health` every minute,
      alerting on a non-200 or on `status` ≠ `ok`, to Tom's phone. (2) Sentry
      → Alerts: a rule for every NEW issue in `production`, and one on the
      `[RATE-LIMIT] would-block` event so the shadow limiter's answer
      arrives instead of being read. (3) Supabase → Project → Reports /
      Settings → Alerts (or the daily e-mail): CPU, RAM, disk IO budget on the
      Micro. Probe: pause the monitor's target once (or point it at a 404
      path) and see the alert land; raise a test event in Sentry.
- [ ] **Launch-day watch.** Sentry carries the environment (10 % traces, no
      PII); the latency watcher during probes; Vercel logs for 500s and
      `[RATE-LIMIT]`; Supabase Reports → RAM / SWAP; the admin console's
      Support queue (reports are tickets; suspend and ban are ticket actions);
      the three alerts above.
- [ ] **The announcement.** The coming-soon contacts with marketing consent
      TRUE get the opening e-mail once e-mail is green; Admin → Contacts
      exports the CSV.

**The switch itself — the day's order (Nov 3 2026).** Owner in brackets;
every line ends in its probe. Nothing below is started until the morning's
`npm run launch:probe` is all ✓ / `–`.

1. [Tom] Supabase → Authentication → "Allow new users to sign up" is already
   ON (the Nov 3 decision) — confirm it; "Confirm email" ON (it is).
2. [Tom] Vercel → Settings → Environment Variables → delete
   `NEXT_PUBLIC_LAUNCH_GATE` from Production → **a REAL build** (push an
   empty commit or Redeploy with "use existing build cache" OFF — the flag is
   inlined, a plain redeploy keeps the gate). The Ignored Build Step does not
   get in the way: an empty commit diffs to nothing and an empty diff BUILDS
   (`decideBuild` in `scripts/vercel-ignore-build.mjs`, the safe default).
3. [Claude] `npm run launch:probe --open`: the gate rows flip (robots allow,
   sitemap 200, `POST /api/signup` no longer 403, the flag absent), the
   sign-up row is judged again, everything else still ✓.
4. [Tom, a throwaway address] Sign up on edgeathlete.ca → "Check your email"
   → the mail from `no-reply@edgeathlete.ca` → the link lands in `/onboarding`
   signed in (Convention 56). Then Forgot password on the same account →
   `/reset-password` on the domain.
5. [Tom, a throwaway Google account] "Continue with Google" as an athlete →
   `/onboarding`; as a parent → `/app/guardian/add-athlete` (§3).
6. [Claude] The signed-out prod specs return to the probe set (share cards,
   `/u/`, org sites, landing, `stats-hub-mobile`); the `launch-gate` spec
   stops applying; one project at a time.
7. [Tom] Vercel → Team → Billing → **Observability Plus back ON** (Tom's Oct
   29 decision: OFF while gated, ON the day the doors open — the per-route
   and per-path views are what the first week's reading needs).
8. [Tom] Google Search Console: the domain property, submit `/sitemap.xml`.
9. [Both] The first-hour watch (the "Launch-day watch" line above).
10. [Tom] The announcement: Admin → Contacts → export the consenting rows
    → a Resend broadcast from `no-reply@edgeathlete.ca`.
11. [Claude, a week on] The limiter flip (PR E) after Tom's Sentry read of the
    first real week; then the iPhone shell program starts.

The rule's history: DEVLOG Sep 30 2026 (the gate), Oct 22 2026 (this
checklist), Nov 3 2026 (the day's order).

## 1. Email deliverability — wired Nov 3 2026 (the human probe still owed)

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

- [x] GoDaddy DNS → the four records above are LIVE and correct (verified
      with `dig` — `docs/HARDENING.md`, "Resend"; this box was stale until
      Nov 2 2026).
- [ ] Resend → Domains → `edgeathlete.ca` → **Verify** → status flips to
      **Verified** (usually minutes, up to an hour). Nov 3 2026: Supabase's
      auth mail is on `smtp.resend.com` with the `re_` key, which Resend
      only honours for a verified domain — the box closes when the probe
      reads the domain (`RESEND_API_KEY` in `.env.staging`) or the first
      mail lands.
- [ ] **Probe:** submit the prod contact form (or trigger any guarded send)
      and confirm the email lands in a real inbox — check spam too.

## 2. Supabase auth email — separate sender from #1

**Confirmations ON (Tom's decision, Nov 2 2026; Convention 56,
`docs/specs/auth-confirmation.md`).** The app is ready for it: the
sign-up form shows "Check your email", the link is handled by
`/auth/confirm`. Two dashboard steps, in this order, AFTER custom SMTP:

1. Authentication → **Email Templates → Confirm signup** → replace the
   body's link with the token-hash form (the default
   `{{ .ConfirmationURL }}` lands as a hash the server never sees):

   ```html
   <h2>Confirm your email</h2>
   <p>Open this link on the device you signed up from to finish setting up your Edge Athlete account:</p>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup">Confirm my email</a></p>
   <p>If you did not create an account, ignore this message.</p>
   ```

   Do the same for **Magic Link** with `&type=magiclink` (unused today;
   ready). Leave **Reset Password** alone — `/reset-password` already works.
2. Authentication → **Sign In / Providers → Email → Confirm email: ON**.
   Probe: `npm run launch:probe` reads `mailer_autoconfirm: false`; the
   real round-trip is the switch's (§0 "The switch"): a throwaway address
   signs up on edgeathlete.ca → the mail arrives → the link lands in
   onboarding, signed in. Staging stays auto-confirm (the four real-sign-up
   specs need it).

Password reset and signup confirmation go through **Supabase's own sender**,
not the app's SMTP. Supabase's built-in sender is rate-limited to a handful of
emails per hour — fine for testing, not for 100 signups.

- [x] Supabase Dashboard → Project → **Authentication → Emails / SMTP
      Settings**: custom SMTP — DONE Nov 3 2026 (`smtp.resend.com`, 465,
      user `resend`, sender `no-reply@edgeathlete.ca`; the probe reads it).
- [x] Authentication → **Rate Limits**: e-mails sent 60/h — DONE Nov 3 2026
      (was 2/h; the probe reads it).
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

## 5b. Vercel Skew Protection — one toggle (Round 1 PR 8, Sep 21 2026) — ON since Nov 3 2026

**DONE Nov 3 2026 (Tom):** the project reads `skewProtectionMaxAge: 43200`
(12 h) from the Vercel API — the toggle is on. The verify line at the end
of this section is the one check still owed after the next deploy.

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
