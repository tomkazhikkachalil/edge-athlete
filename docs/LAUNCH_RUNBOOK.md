# Launch Runbook — the four ops gates before real users

Everything in this file is a **console/dashboard action** (nothing here ships
in a PR), listed in priority order. Each section ends with a probe that proves
the gate is actually open — run the probe, not just the config.

Status legend: check the box when the probe passes, not when the setting is
saved.

---

## 1. Email deliverability — BLOCKING (every app email 550s today)

The app sends through Resend as an SMTP relay (`SMTP_*` vars in Vercel), but
the sending domain has never verified because the **GoDaddy zone for
`edgeathlete.ca` is unpublished** — so SPF/DKIM can't resolve and Resend
rejects sends with 550. Context: DEVLOG entries around Aug 21 (guardian arc
wrap-up). Broken until fixed: **guardian invites** (a minor signing up gets
parked with no email to the parent), **transfer verification codes**, contact
form, calendar invites, digest.

- [ ] GoDaddy → My Products → `edgeathlete.ca` → DNS: confirm the zone is
      **published/active** (this has been the actual blocker — records can't
      exist in an unpublished zone).
- [ ] Resend dashboard → Domains → `edgeathlete.ca`: copy the SPF TXT record
      and the DKIM CNAME records it lists.
- [ ] GoDaddy DNS → add those records exactly as shown.
- [ ] Resend → Domains: wait for status to flip to **Verified** (can take up
      to an hour; DNS propagation).
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

## 3. Google sign-in — code-complete, config-only

The buttons render on the login page and both signup branches the moment the
flag is set; `/auth/callback` handles the PKCE exchange and the
`ea-signup-role` cookie routes OAuth parents to a parent profile.

- [ ] Google Cloud Console → APIs & Services → Credentials → OAuth client:
      - Authorized JavaScript origins: the prod domain.
      - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
- [ ] Supabase → Authentication → Providers → Google: enable, paste client ID
      + secret.
- [ ] Supabase → Authentication → URL Configuration: prod domain in Site URL +
      redirect allow-list (should already be there).
- [ ] Vercel → Settings → Environment Variables → `NEXT_PUBLIC_OAUTH_GOOGLE=1`
      (Production) → **redeploy** (the flag is inlined at build time — no
      redeploy, no buttons).
- [ ] **Probe:** signed-out prod → "Continue with Google" appears on login AND
      on the athlete + parent signup branches → complete a Google signup with
      a throwaway account → athlete path lands in complete-profile/onboarding;
      parent path creates a PARENT profile (not an athlete).

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

---

*Everything else previously suspected as a launch gap was verified handled in
code (password reset, empty-feed experience, health/Sentry/CI/rate limiting,
PWA baseline). `docs/ROADMAP_2026-07.md` is historical — don't launch-plan
from it.*
