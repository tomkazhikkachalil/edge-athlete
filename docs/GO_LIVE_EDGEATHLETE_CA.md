# Go-live on edgeathlete.ca — the domain cutover checklist

Written Sep 29 2026, from the code (every host dependency swept) and from
`edgeathlete.ca`'s live DNS that day. It moves the app from
`https://edge-athlete.vercel.app` to **`https://edgeathlete.ca`** as the one
official address, with `www` redirecting to it.

**The one rule:** the domain, Supabase and the OAuth clients move **together**.
Half-doing it is the only dangerous state: sign-in and password-reset links
break when the address changes without the config following (LAUNCH_RUNBOOK §5).
Follow the phases in order. Check a box when its **probe** passes, not when the
setting is saved.

Who does what: **[Tom]** is a console or dashboard action; **[Claude]** is a PR.

---

## What is true today (Sep 29 2026)

| | Today | After go-live |
|---|---|---|
| `edgeathlete.ca` A | `13.248.243.5`, `76.223.105.230` (GoDaddy's website builder, a page titled "Edge Athlete") | Vercel's record |
| `www.edgeathlete.ca` | CNAME → `edgeathlete.ca` | Vercel's record (redirects to the apex) |
| MX | `edgeathlete-ca.mail.protection.outlook.com` (**Microsoft 365**) | **unchanged** |
| TXT (root) | `v=spf1 include:secureserver.net -all`, `NETORG17822398.onmicrosoft.com` | **unchanged** |
| Resend (`send` TXT + MX, `resend._domainkey`, `_dmarc`) | **present** | **unchanged** |
| Nameservers | GoDaddy (`ns69/ns70.domaincontrol.com`) | **unchanged** (the M365 records live there) |
| App address | `edge-athlete.vercel.app` | `edgeathlete.ca`; the vercel.app address **keeps working** |

**Rollback at any point:** put the two GoDaddy A records back (`13.248.243.5`,
`76.223.105.230`), and unset `NEXT_PUBLIC_APP_URL` and rebuild. The
`vercel.app` address never stops serving the app.

---

## Phase 0: before the day

- [ ] **[Tom] Vercel plan.** The project is on **Hobby**, which Vercel's terms limit to personal, non-commercial use. A business launch belongs on **Pro**. Pro also brings Skew Protection (LAUNCH_RUNBOOK §5b), which is one toggle once you're on Pro.
- [ ] **[Tom] Lower the TTL** on the apex A records and the `www` CNAME at GoDaddy to 600 seconds, a day ahead, so the switch spreads in minutes.
- [x] **[Claude] The code-prep PR** (nothing in it changes behaviour until the env var is set):
  - The e2e suite knows **every** production host (`PROD_APP_HOSTS` in `e2e/helpers/qa-user.ts`: the vercel.app alias, `edgeathlete.ca` + www, the planned `.com` + www). The prod refusal and the deploy wait read the list; `e2e-prod-guard.test.ts` pins it.
  - `npm run test:e2e:prod` still targets the vercel.app alias (it always serves production). After Phase 4, probe the domain itself with `E2E_PROD_URL=https://edgeathlete.ca npm run test:e2e:prod`.
  - The Nominatim User-Agent reads `NEXT_PUBLIC_APP_URL`. The ~20 `|| 'https://edge-athlete.vercel.app'` fallbacks stay (harmless once the env is set).
  - Already done in #1010: the one support address everywhere, and the recovery search recognising `.ca`.
- [ ] **[Claude] Migration 246** re-points the two pg_cron jobs (`calendar-reminders`, `urgent-emails`) at `https://edgeathlete.ca/api/cron/…`. It rewrites only the host inside each job, so the secret is never re-typed. **Its PR stays unmerged until Phase 7.** Run early, the jobs would call GoDaddy's page and silently do nothing.

## Phase 1: add the domain in Vercel (nothing changes for users yet)

- [ ] **[Tom]** Vercel → edge-athlete → **Settings → Domains** → add `edgeathlete.ca`, then add `www.edgeathlete.ca` and choose **Redirect to `edgeathlete.ca`** (308). The code doesn't redirect www itself; Vercel does it at the edge.
- [ ] **[Tom]** Note the exact records Vercel shows for each, usually an **A** record for the apex and a **CNAME** for www. **Use Vercel's values, not a remembered IP.** They'll read "Invalid configuration" until Phase 3; that's expected.

## Phase 2: open the doors in Supabase and Google first (harmless in advance)

- [ ] **[Tom] Supabase** (the **prod** project) → Authentication → **URL Configuration** → **Redirect URLs**: add `https://edgeathlete.ca/**` and `https://www.edgeathlete.ca/**`. **Keep** `https://edge-athlete.vercel.app/**` and `http://localhost:3000/**`. Leave the **Site URL** alone until Phase 5.
- [ ] **[Tom] Google Cloud Console** → the OAuth client used by Supabase → **Authorized JavaScript origins**: add `https://edgeathlete.ca` and `https://www.edgeathlete.ca`. The **redirect URI stays Supabase's** (`https://<prod-ref>.supabase.co/auth/v1/callback`), so don't change it. Google's OAuth consent screen: add `edgeathlete.ca` to **Authorized domains**, and point the homepage, privacy (`/privacy`) and terms (`/terms`) links at the new domain.
- [ ] **[Tom]** If Apple sign-in is ever turned on (`NEXT_PUBLIC_OAUTH_APPLE`), its Services ID needs the same domain. It's off today.

## Phase 3: point the DNS (the switch)

- [ ] **[Tom] GoDaddy** → the site built with GoDaddy's website builder: **disconnect it from the domain** (or unpublish it) first. Otherwise GoDaddy keeps restoring its own A records.
- [ ] **[Tom] GoDaddy DNS** → edit **only** these:
  - the apex **A** record(s): delete `13.248.243.5` and `76.223.105.230`, and add Vercel's A value;
  - **www**: change the CNAME from `edgeathlete.ca` to Vercel's CNAME value.
- [ ] **Do NOT touch:** MX (Microsoft 365 mail), the root TXT records (the M365 SPF and verification), `send` (TXT + MX), `resend._domainkey`, `_dmarc`, or the nameservers. Changing any of these breaks company email or app email.
- [ ] **Probe:** Vercel → Domains shows both **Valid Configuration** with a certificate issued. Then `https://edgeathlete.ca` serves the app and `https://www.edgeathlete.ca` 308s to it. (The GoDaddy page sent HSTS; that only requires HTTPS, which Vercel serves.)

## Phase 4: tell the app its name (a real build)

- [ ] **[Tom or Claude] Vercel env:** `NEXT_PUBLIC_APP_URL=https://edgeathlete.ca`, **Production only** (Preview and Development keep their own). It's a `NEXT_PUBLIC_*` value, **inlined at build time**, so it takes a **new build**: merge any PR to main, or Deployments → Redeploy with **"Use existing Build Cache" unticked**.
- [ ] What it moves, all read from that one variable:
  - canonical URLs, `metadataBase`, `og:url` and share-card images;
  - `/robots.txt` and `/sitemap.xml`;
  - every email link (invites, digest, transfers, guardian, calendar);
  - `.ics` feed URLs, and the middleware's apex for org subdomains and custom domains.
- [ ] **Probe:** `curl https://edgeathlete.ca/api/health` shows the new commit. View source on `/u/<a public handle>` shows canonical and `og:url` on `edgeathlete.ca`. `/robots.txt` names `https://edgeathlete.ca/sitemap.xml`.

## Phase 5: flip Supabase's Site URL

- [ ] **[Tom] Supabase** → URL Configuration → **Site URL** = `https://edgeathlete.ca`. Supabase's own emails (confirm signup, reset password, magic link) build their links from it.

## Phase 6: prove it (the day's probe list)

- [ ] Sign in with email and password on `edgeathlete.ca`. Refresh; you're still signed in.
- [ ] **Continue with Google**, all the way through, lands back on `edgeathlete.ca`, signed in.
- [ ] **Forgot password:** the email's link opens `edgeathlete.ca/reset-password`, and a new password works.
- [ ] A **share link** from a post (`/r/<id>`) pasted into a message unfurls with the card and an `edgeathlete.ca` address.
- [ ] An **org site** (`/org/<slug>`) loads with its canonical on the new domain.
- [ ] A **calendar feed**: Settings → Calendar feed → the subscription URL starts with `edgeathlete.ca`.
- [ ] **[Claude]** The prod e2e probe against the domain (`E2E_PROD_URL=https://edgeathlete.ca npm run test:e2e:prod`), plus `check:schema:prod`.
- [ ] The old address still works: `https://edge-athlete.vercel.app` serves the app. Leave it; the crons and tests may still call it.

## Phase 7: after the move

- [ ] **[Tom]** Run migration 246 in the prod SQL editor (expect `246 APPLIED | 2 | 2 | 0 | 246`), then [Claude] runs it on staging and merges its PR.
- [ ] **[Tom] Google Search Console:** add the `edgeathlete.ca` domain property (DNS TXT verification at GoDaddy, alongside the others) and submit `https://edgeathlete.ca/sitemap.xml`.
- [ ] **[Tom] Strava** (when the app exists): change the **Authorization Callback Domain** to `edgeathlete.ca`, then submit for review from the real domain.
- [ ] **[Tom] Garmin:** apply to the Connect Developer Program now that the company website is the product.
- [ ] **[Tom] Update links** you control: social bios, email signatures, anywhere the vercel.app address was shared.

## Parked (decide later; not needed for go-live)

- **Outbound email** stays off until "going public" (paid Resend; DEVLOG, memory). The DNS is already in place. Then: verify the domain in the Resend dashboard, set `SMTP_*` and `EMAIL_FROM=noreply@edgeathlete.ca`, and run LAUNCH_RUNBOOK §1–§2's probes.
- **Org subdomains** (`kmha.edgeathlete.ca` → the org's site; `ORG_SUBDOMAINS=1`, build-injected) need a **wildcard** `*.edgeathlete.ca` on Vercel. Vercel only issues wildcard certificates when the domain uses **Vercel's nameservers**, which means moving DNS off GoDaddy and re-creating the M365 and Resend records there. It's a separate decision.
- **Org custom domains** (`CUSTOM_DOMAINS=1`, LAUNCH_RUNBOOK §5a) need `VERCEL_API_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID`. **Note:** once the apex is `edgeathlete.ca`, the code refuses any `*.edgeathlete.ca` host as an org domain (`isReservedDomain`), so the §5a probe needs a **different** test domain you own.

## Later: moving to edgeathlete.com

`edgeathlete.com` is registered (since 2014) and **listed for sale on HugeDomains** (Sep 29 2026). If it's bought:

1. Vercel: add `edgeathlete.com` + `www` and decide which apex is primary. The code knows **one** apex (`NEXT_PUBLIC_APP_URL`), so the other must **redirect at Vercel's domain level**, never be served as a second home.
2. Repeat Phases 2–6 with `.com`: Supabase redirect URLs + Site URL, Google origins and authorized domain, DNS, the env var and a build, the probes.
3. Email from `.com` would need its own Resend domain and DNS; keep sending from `.ca` until then. **Company mail** (M365) stays on `.ca` unless you move it.
4. Update Strava's callback domain, Search Console (add the `.com` property; the redirect carries ranking), and the recovery search's host list (already includes `.com`).
