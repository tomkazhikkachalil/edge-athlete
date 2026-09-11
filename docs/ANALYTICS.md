# Site analytics — what is counted, what is stored (program 2, E — Sep 11 2026)

Tom's decision: first-party counts, never a third party. This is the whole of it.

## What is counted

- A **page view**: one load of a PUBLISHED org-site page (the home, a module
  subpage, a custom page — both route trees and custom domains). The page
  carries a 1×1 GIF, `/org/{slug}/hit.gif`, a plain image with no script; the
  route is `no-store`, so every load fetches it.
- A **visitor**: one browser, counted once per UTC day per site.

## What is NOT counted

- Bots and previewers (a short user-agent denylist) and blank user agents.
- Browsers that send `Sec-GPC: 1` (Global Privacy Control) or `DNT: 1`.
- Requests without a same-origin referrer, with a foreign one, or from the
  draft preview.
- Anything at all when `ANALYTICS_SALT` is not configured.

The pixel answers the same GIF in every case — it is never a signal to the
visitor.

## What is stored

- `org_site_stats_daily (site, day, path) → views, visitors` — counts only.
- `org_site_hit_marks (site, day, visitor_hash)` — the day's visitor marks:
  `sha256(HMAC(ANALYTICS_SALT, day) + ip + user-agent)`, truncated. The salt
  is per day, so the same browser is one mark today and an unlinkable mark
  tomorrow. **No IP address, user agent or cookie is ever stored**, and there
  is nothing to look a visitor up by.
- Both tables are service-role only (posture A); the RPC `bump_site_hit` is
  `service_role`-only.

## Retention

The daily cron prunes visitor marks older than 2 days (the daily row keeps
the counts) and daily rows older than 400 days.

## Who sees it

- The org's managers (`manage_site`), in the console's **Visitors** panel:
  views and visitors for the last 7 / 30 / 90 days, a sparkline, the top
  pages. Nothing personal can be shown because nothing personal is stored.
- Admins: platform totals for the last 30 days on the dashboard's Site
  builder panel.

## Operating it

- `ANALYTICS_SALT`: any long random string, set in Vercel. Rotating it makes
  the same browser look new on the day of the change — acceptable.
- The sweep line in `docs/HARDENING.md` B5.
