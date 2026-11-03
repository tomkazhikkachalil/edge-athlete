# Sign-up with e-mail confirmations ON

## Convention 56 — A sign-up that must confirm says so; the link is `/auth/confirm` by token hash; every door after it is `destinationFor` (Nov 2 2026)

**A sign-up that must confirm says so; the link is `/auth/confirm` by
token hash; every door after it is `destinationFor` (Nov 2 2026)** —
Tom's launch decision: production confirms by e-mail (Supabase
"Confirm email" ON; it was OFF, and every sign-up path signed the account
in by password right after the 201). The rules:

- **The API says it.** `POST /api/signup` answers `confirmationRequired:
  !data.session` with its 201 (`src/app/api/signup/route.ts`), and passes
  `emailRedirectTo: <app>/auth/confirm` so even the default template lands
  on the app. The parked-minor branch is untouched (no auth user exists
  there).
- **The form shows "Check your email".** `RegistrationSteps` (the four
  handlers: guardian, scout, organizer, athlete) and the flag-off form on
  `/` read `confirmationRequired` BEFORE any `signInWithPassword` and show
  the `check-email` step: the address, a **Resend** door
  (`supabase.auth.resend({ type: 'signup' })`, the login page's own call),
  "Wrong address? Start over". Copy: `COPY.AUTH.*`.
- **The link is `/auth/confirm` by TOKEN HASH.** The Supabase *Confirm
  signup* template points at
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`
  (`LAUNCH_RUNBOOK.md` §2 holds the body to paste). The route verifies it
  with `verifyOtp` through a cookie-writing SSR client (the callback's
  documented exception), stamps `onboarded_at` for a scout or organizer
  (their wizard is the sign-up form; the old automatic sign-in stamped it)
  and redirects. A PKCE `?code=` is exchanged; a bare visit goes to
  `/?signin=1` (the implicit hash survives the redirect for the browser
  client); a used, expired or invalid link lands on `/?error=<sentence>`,
  where the sign-in page shows it and holds its "Resend confirmation
  email" door. A `type=recovery` link goes to `/reset-password`.
- **Where next is ONE rule.** `src/lib/auth-destination.ts
  destinationFor(profile)` (zero imports): no profile → complete-profile;
  parent → the guardian console or add-athlete; organizer → the feed or
  the club wizard; scout → the scouting area; everyone else → the profile
  or onboarding. The OAuth callback and the confirmation link both import
  it (pinned).
- **Staging auto-confirms; production does not.** The four real-sign-up
  specs (`scout-signup`, `scout-search`, `scout-search-performance`,
  `club-signup-door`) sign in by password after the 201 and run on staging
  only (each says so at its top). The confirmation round-trip is
  `e2e/auth-confirm.spec.ts`: `generateLink` mints the very token the mail
  carries → the athlete lands in onboarding with a session, the scout in
  the scouting area stamped onboarded, a used link on the sentence; the
  form's screen is probed with a mocked 201.

Pins: `auth-destination.test.ts` (the doors; the two routes import the
rule; the API's two lines), `e2e/auth-confirm.spec.ts`.
