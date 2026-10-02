# Phone notifications and the app icon's number (mig 248, Oct 2026)

Tom: *"Add an app icon indicator on mobile to signal when new or relevant
activity is available while the user is outside the app. Tapping into the app
should open the relevant area."*

Tom's decisions (Oct 2 2026):
- **Everything the bell gets is pushed.** The per-type switches in Settings → Notifications still apply.
- **A tap opens the exact item.**
- **Opening the app from the icon** lands on the feed as before, with the bells lit.
- **Library:** `web-push` (the standard open-source sender; no paid service).

## What the person sees

- **Turning it on:**
  - The installed app's feed shows a "Know when something happens" card. Tom (Oct 2, option 1): it **stays until the person chooses** — "Turn on notifications", or "Not now" (the X too), which puts it away for a week on that device before it asks again (`src/lib/push/card.ts`). A device blocked in the phone's settings is never asked.
  - Settings → Notifications → **On this device → Phone notifications** is the switch, with "Send a test notification" once it is on.
- **Per device:** a person can have their phone buzz and their laptop not.
- **When something happens** (a message, a comment, a fan request, an event invite, a result…): a notification arrives within about a minute. The app icon carries the bell's unread count.
- **Likes and messages:** likes on one post replace each other on the lock screen, and so do messages in one conversation.
- **A direct message never shows its words on the lock screen.** The title says who wrote; the body says "Tap to read".
- **Tapping a notification** opens the item (the notification row's own `action_url`) and marks it read.
- **Inside the app**, the icon's number follows the bell: read something and it drops.
- **Signing out** turns the device off first, so a shared phone never shows the previous person's alerts.

## What each platform allows (not ours to change)

| Device | Works? | Notes |
| --- | --- | --- |
| iPhone / iPad, iOS 16.4+ | **Only in the app opened from the home-screen icon** | The permission must come from a tap. Every push shows a banner (Apple allows no silent badge for web apps). In a Safari tab, Settings says "use the app on your home screen" and offers the install guide. |
| Android (Chrome, Edge, Samsung) | Yes, in the installed app or the browser | The launcher dot or number comes from the shown notification. |
| Desktop Chrome / Edge / Firefox / Safari | Yes | `setAppBadge` shows on an installed app's dock or taskbar icon. |
| In-app browsers (Instagram, Facebook) | No | Settings says the browser can't. |

## How it works

```
~60 writers + 7 triggers ──insert──▶ notifications (pushed_at NULL)
                                          │
pg_cron `push-sweep` (every minute) ──POST /api/push/sweep (CRON_SECRET)
                                          │  runPushSweep: CLAIM fresh rows (stamp pushed_at first),
                                          │  stamp stale ones unsent, newest per tag, ≤3 per person
                                          ▼
                       src/lib/push/send-server.ts (the ONE sender)
                         web-push builds the encrypted request; fetch sends it
                                          ▼
                     the device's push service (Apple / Google / Mozilla)
                                          ▼
                    public/sw.js: show it, set the icon number; on tap → open + mark read
```

- **`push_subscriptions` (248):** one row per device, posture A (service role only).
  - Written by `/api/push/subscriptions` (POST upserts on the endpoint, so a new sign-in on the same phone moves the row; DELETE is the person's own).
  - Pruned by the sender on 404/410 and after 5 consecutive failures.
- **`notifications.pushed_at` (248):** NULL means the sweep has not considered the row.
  - Every row is stamped whether or not a device received it.
  - Rows older than 15 minutes are stamped without a send, so a stopped job never floods phones later.
- **The job:** scheduled only where `urgent-emails` runs (production), copying that job's Authorization header, so the migration carries no secret. Staging runs no pg_cron jobs; the daily cron runs the sweep as a safety net.
- **`/api/push/config`** answers whether the deployment holds the keys, plus the PUBLIC key. Without keys no door shows anywhere.
- **The service worker** handles `push` and `notificationclick` only.
  - **No fetch handler, no cache.** Pages load exactly as before. Offline is a separate round.
  - `buildCsp` carries `worker-src 'self'` (needed because `'strict-dynamic'` makes script-src ignore `'self'`).
  - `vercel.json` serves `/sw.js` `no-cache`.

## Keys (Vercel env, Production + Preview)

| Variable | What |
| --- | --- |
| `VAPID_PUBLIC_KEY` | `npx web-push generate-vapid-keys` → publicKey |
| `VAPID_PRIVATE_KEY` | → privateKey (Sensitive) |
| `VAPID_SUBJECT` | `mailto:<the operator's address>` |

- Read at runtime, so a change needs only a redeploy, not a fresh build.
- **Rotating the keys** invalidates every device's subscription. On its next start the app re-subscribes only if the person had notifications on and permission is granted (`enablePush` replaces a subscription made against an old key when the switch is used). Expect people to turn it on again.
- `PUSH_MOCK_BASE` is e2e only, and a production deployment ignores it.

## Troubleshooting

- **"Send a test notification" fails:**
  - Check the deployment's keys: `GET /api/push/config` should answer `enabled: true`.
  - Check the device's row: `push_subscriptions.failure_count`.
- **Nothing arrives, but the test works:** check the job on production with `SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'push-sweep') ORDER BY start_time DESC LIMIT 5;`.
- **iPhone shows nothing:**
  - It must be the home-screen app, iOS 16.4 or later.
  - Settings → Notifications → Edge Athlete must be allowed.
  - Focus modes silence banners.
- **The icon number is stale:** opening the app resets it to the bell's count.

## Proof

- **Unit:** `src/lib/push/__tests__/push.test.ts` covers the payload, tags, path safety, keys, config, platform states and the migration ⇄ code agreement.
- **e2e:** `e2e/push.spec.ts`.
  - **The server half end to end:** a stand-in push service DECRYPTS what the sweep sent.
  - **Production:** the every-minute job claims a QA row by itself.
  - **The device half:** the worker registers under the CSP; iPhone tab → home-screen message; blocked → no switch; the installed app → card + switch; the icon follows the bell.
- **A real banner on a real phone is Tom's device check.** Headless browsers cannot receive pushes.
