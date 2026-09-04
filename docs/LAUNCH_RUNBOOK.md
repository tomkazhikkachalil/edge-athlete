# Launch Runbook — the five ops gates before real users

Everything in this file is a **console/dashboard action** (nothing here ships
in a PR), listed in priority order. Each section ends with a probe that proves
the gate is actually open — run the probe, not just the config.

Status legend: check the box when the probe passes, not when the setting is
saved.

---

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
      permission. The composer's "Camera not working? Use the in-app camera"
      link is the documented fallback; confirm it reaches the editor.

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
the ORG_SUBDOMAINS precedent). Test hostname for the prod probe: any
Tom-controlled subdomain of `edgeathlete.ca` (TXT + CNAME at GoDaddy).
Rollback = unset the flag + build; claimed domains simply stop routing
(the apex address always works).

## 5. (Optional decision) Custom domain — currently NOT pointed at Vercel

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
