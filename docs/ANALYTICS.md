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


## Post impact — views and plays (migration 252, Oct 4 2026)

Tom: "if anyone interacts with your posts, but they don't like or comment on
it, I want there to be an 'impact' so you know that 1000 ppl viewed your post
or watched your video." His decisions: **everyone** sees the numbers (the
YouTube posture — likes and reach both public); a view counts **once per
person per post per day**; a video play after **3 s** of playback, once per
person per day; the author's own looks never count.

- **The mark** (`src/lib/views/hash.ts viewerMark`): the org-site rule above —
  `sha256(HMAC(salt, day) ‖ viewer)` — where a signed-in viewer is `u:<user id>`
  (never their IP: a phone changes networks) and an anonymous one is
  `ip ‖ user agent`. Unlinkable across days; nothing about WHO is stored. The
  salt is `ANALYTICS_SALT`, else `MEDIA_PROXY_SECRET` (the HMAC-key family);
  without either nothing is counted (a supported state).
- **What counts** (`src/hooks/useViewBeacon.ts`, `PostCard`'s video): a card at
  least half on screen for one second, or a share-page visit (`/r/[postId]`);
  a video's `timeupdate` crossing 3 s. The client queue (`src/lib/views/
  client.ts`) sends one (post, kind) per tab per UTC day, flushing after 2 s,
  at 50 items, and on `pagehide` — a `keepalive` POST.
- **The beacon** `POST /api/posts/views` answers **204 whatever happens**
  (limited, a bot, `Sec-GPC` / `DNT`, no salt, a bad body, a database error —
  the `csp-report` precedent); the server keeps only PUBLISHED posts the viewer
  may see (public · own-followed) and did not write, then one RPC
  `bump_post_views(day, items)` inserts each mark `ON CONFLICT DO NOTHING` and
  bumps `posts.views_count` / `posts.plays_count` only when the mark was new.
- **Tables:** `post_view_marks (post_id, day, kind, viewer_hash)` — posture A,
  pruned after 2 days by the daily cron (`runPostViewsPrune`); the counters on
  `posts` keep the totals (`*` selects carry them; absent pre-252 reads as no
  count).
- **On the card:** "1.2K views · 300 plays" (`compactCount`), its own line on a
  phone, inline from `sm` up; hidden at zero.
