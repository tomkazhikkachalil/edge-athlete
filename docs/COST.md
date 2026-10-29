# Cost — what Vercel and Supabase charge for, and what we do about it

Written Oct 29 2026 from the Vercel API, the repo and the billing docs, after Tom asked whether the bill "will grow with users or with the changes made". Read this before touching builds, polling, media delivery or anything that runs per request.

## The two curves

**1. Grows with the pace of change, not users** — build CPU, Deployment Storage + Functions Storage, GitHub Actions minutes. In the 30 days to Oct 29: 679 deployments (361 production, 318 preview), ~1.8 min each on a 4-vCPU elastic "standard" machine; 931 deployments retained. Of the 354 merges to main, 93 (57 docs-only + 36 migration + docs) rebuilt the app for no app change. Nothing a user feels.

**2. Grows with users** — function invocations, Active CPU, Provisioned Memory, edge requests, data transfer, image transformations, Observability Plus events, Supabase compute and egress. All of it was tiny while the site was gated. The multiplier is **polling**: an idle signed-in tab used to make ~3 function calls a minute (`useLiveNow` ×2 per minute, `MessagesProvider` ×2 per 2 minutes), 6 on `/feed`. At roughly $10 per 1M requests all-in (invocation + 2 GB memory for ~0.25 s + ~4 observability events + edge request), a user with the app open an hour a day cost ≈ $0.05/month in polls against ≈ $0.03/month in real actions — 10k such users ≈ $850/month, two-thirds of it timers.

## The rates that matter (Pro, USD, Oct 2026)

| Line | Rate | Included |
| --- | --- | --- |
| Pro platform fee | $20/month | $20 usage credit, 1 deploying seat, Flat Rate CDN (1M CDN requests + 1 TB transfer) |
| Build CPU (elastic standard = 4 vCPU) | $0.0035 per CPU-minute (≈ $0.014 per build minute) | — |
| Deployment Storage / Functions Storage | $0.10 per GB-month each | per plan allowance, see the Usage page |
| Function invocations | $0.60 per 1M | — |
| Active CPU | $0.128 per CPU-hour | — |
| Provisioned Memory (Standard = 2 GB / 1 vCPU) | $0.0106 per GB-hour, for the whole time a request is in flight | — |
| Observability Plus | $1.20 per 1M events — one per edge request, middleware run, function invocation AND each external API call a function makes (every Supabase trip) | none; **enabled by default** on teams upgraded to Pro after Apr 3 2026 — ours was, on Sep 30 2026 |
| Image transformations | one per cache MISS or STALE revalidation; `minimumCacheTTL` is 1 day on purpose (a post flipping private must leave the cache within the CDN window) | — |
| Supabase | Pro $25 + Micro production $10 + Micro staging $10; Realtime 500 peak connections then $10 per 1,000; egress 250 GB then $0.09/GB | — |

## What is in place

- **Observability Plus is off** (Tom, Oct 29 2026). Sentry carries errors and 10 % traces; the free tier keeps 1-day logs and function metrics. Turning it back on makes every request bill ~4 events.
- **Retention policy** (project → Settings → Security): previews 7 days, canceled/errored 1 day, production 30 days. Vercel keeps the last 10 deployments and the last 20 Ready production deployments regardless, so rollback is untouched.
- **Spend alert** at $50 per cycle (team → Billing → Spend Management).
- **The Ignored Build Step** — `vercel.json` `ignoreCommand` → `scripts/vercel-ignore-build.mjs`:
  - production skips when the merge touches only `docs/`, `e2e/`, `scripts/`, `.github/`, `database/` or `*.md` (the diff is against the deployed sha when the shallow clone has it, else `HEAD^`; an unavailable diff builds). The deployment shows as **Canceled**, production keeps the previous build, and `/api/health` keeps the previous commit — so the "health shows the commit" proof in the maintenance checklist applies to code merges only.
  - a preview builds only on a `preview/**` branch or with `[preview]` in the commit message. Need a preview of a branch? Push one commit with `[preview]` in its message.
  - `scripts/merge-pr.sh` classifies the merge commit the same way and does not wait for a build that will not happen.
- **Previews point at staging Supabase** (`scripts/vercel-preview-env.mjs`); CI's smoke job builds on the GitHub runner and never uses a preview.
- **pg_cron → Vercel** (~4,200 calls/day: push-sweep and media-jobs every minute, golf-map-sweep every 2, health every 5, reminders/urgent-emails every 10) is a fixed floor of ≈ $1/month. Left alone on purpose: the every-minute ticks are latency a user feels (a push, a video poster), and they keep the functions warm.

## The user-scaling levers (ranked)

1. **Polling → signals.** The pulse program (`docs/specs/pulse.md`): one `/api/me/pulse` endpoint behind one RPC, Realtime BROADCAST from DB triggers (`live-now` public topic, `user:{id}` private topic) and a 10-minute safety net — ≈ 95 % fewer idle invocations, fresher than the timers.
2. **Fewer trips per request.** The trip-count program (migrations 280–284) — one RPC per read where the viewer's side was 4–8 queries. Keep going: every Supabase trip is a function-time cost and (if Plus is ever on) an event.
3. **Media bytes.** Every protected download streams through `/api/media/[token]` (public media is CDN-cached a day). A GB of video watched through the proxy costs origin + data transfer on Vercel (≈ $0.21/GB past the flat-rate tier) plus Supabase egress on misses. Serving private media by short-lived Supabase signed URLs (a 302 from the proxy) would cut that to Supabase egress (≈ $0.09/GB) and take the function out of the byte path — at the price that a post flipping private takes effect within the signed-URL TTL instead of instantly. **Decide when media transfer passes the included tier**, not before.
4. **Image optimizer cardinality.** `qualities` [75, 85, 90] and `deviceSizes` up to 3840 multiply transformations per image. A measured change only if the Usage page shows transformations past the credit; the 1-day TTL stays.
5. **Function memory.** Standard (2 GB / 1 vCPU) is the only size below Performance on Fluid; nothing to lower.

## The monthly glance

In the maintenance round, open the team's **Usage** page and write three numbers into the devlog entry: builds (count and CPU minutes), Deployment + Functions Storage (GB-months), and the invocations line. The "before" numbers are the ones at the top of this file. A line that moved without a known cause is a finding.
