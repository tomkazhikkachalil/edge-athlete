# Backup & restore runbook

**Owner:** Tom. **Written:** Sep 21 2026 (Round 1 PR 9 of the Sep 19
assessment). **Status:** the plan tier and the two decisions below are
Tom's to fill in — until they are, this document describes what Supabase
offers and what the app needs, not what is in place.

The Sep 19 assessment's finding: nothing in the repo says whether
production can be restored, from what, to when, or how long it takes. This
is that page. It is short on purpose; a runbook nobody reads is a runbook
nobody runs.

---

## 1. What exists today (fill in — the facts are in the Supabase dashboard)

| Question | Where to look | Answer (Tom) |
| --- | --- | --- |
| Which plan is the production project on? | Supabase → Organization → Billing | ☐ Free ☐ Pro ☐ Team |
| Are daily backups present? | Project → Database → Backups | ☐ yes, n days ☐ none |
| Is PITR enabled? | Project → Database → Backups → Point in Time | ☐ yes ☐ no |
| Compute add-on? (PITR needs ≥ Small) | Project → Settings → Compute | |

What Supabase provides (docs read Sep 21 2026):

- **Free:** no backups at all. A restore is impossible unless we made our
  own dump.
- **Pro:** daily backups, the last **7 days** kept. **Team:** 14. Enterprise:
  up to 30. A daily backup's worst case loses **up to 24 h** of writes.
- **PITR** (add-on on Pro+; needs the Small compute add-on; ~$100/mo at
  7 days' retention): restore to any second, worst-case data loss
  **2 minutes**.
- **Backups do not include Storage objects** — the database holds only
  their metadata. Every avatar, post photo, round photo, org logo and
  ticket screenshot lives in Storage (the `uploads` bucket carries nearly
  everything; `avatars` and `post-media` are the legacy pair), and a
  deleted object is gone from every backup instantly.

**Never delete a user from the Supabase dashboard** (Sep 24 2026, mig 238).
Since 238 a profile no longer cascades from its auth user — the row has to
outlive the login so a departed person's results keep their name. A
dashboard delete now leaves an ORPHAN profile with its personal data; the
account's owner deletes through Settings, and an owner purges a parked
account from the admin dashboard ("Purge a parked account now"). The
twin `verify-238-departed-profiles.sql` counts orphans.

## 2. The decisions (Tom)

**Decision A — the database tier.** Recommendation: **Pro with daily
backups is the floor** the moment a real athlete's rounds live here (they
do: ~6 real people as of Sep 19). PITR when the first org runs a real
season on the platform — a league's standings lost to a 24 h window is a
different kind of incident from a lost post.

- ☐ Free (accepted risk: no restore) — not recommended past the MVP
- ☐ Pro, daily (RPO ≤ 24 h)
- ☐ Pro + PITR 7 d (RPO ≤ 2 min)

**Decision B — Storage.** There is no Supabase-side backup of buckets.
Options, cheapest first:

- ☐ Accept the risk for now, revisit with the first paying org (the media
  proxy already refuses to serve what is missing — a lost object is a
  broken image, never an error page).
- ☐ A nightly bucket mirror to a second bucket/project (a cron phase in
  `src/app/api/cron/daily/route.ts` listing each bucket and copying new
  objects — hosted, not local; ~1 PR). Not built until chosen.

## 3. The stated targets (once A and B are chosen)

| | Database | Storage |
| --- | --- | --- |
| **RPO** (how much we can lose) | 24 h on daily · 2 min on PITR | until B: everything since the object was written |
| **RTO** (how long to get back) | daily: minutes to tens of minutes (Supabase's restore, downtime scales with DB size — ours is small) · PITR: the same plus choosing the second | until B: no recovery |

## 4. Restore — the steps

**A restore OVERWRITES the production project** with the backup's state
and the project is unreachable while it runs. Everything written after the
chosen point is gone. So, in order:

1. **Stop the bleeding first.** If the cause is still running (a bad cron
   phase, a migration, a script), stop it: Vercel → the deployment → pause
   the cron in `vercel.json` by redeploying the previous commit, or revoke
   the key the script used.
2. **Decide the point.** Daily: the most recent backup BEFORE the damage.
   PITR: the minute before. Write the chosen timestamp in the incident
   note before clicking anything.
3. **Announce.** The app has no maintenance page; the honest move is a
   line on the login page (`src/app/(app)/page.tsx` — a `StickyBanner`) in
   a hotfix deploy, or accept the minutes of 5xx for a small restore.
4. **Restore.** Supabase → Database → Backups → the backup (or the PITR
   timestamp) → Restore → confirm. Wait for the project to report healthy.
5. **Verify.** `GET https://<app>/api/health` → 200 `database: ok`;
   `npm run check:schema` from a machine with the service key → 0 drift
   (the chain's head must match the restored schema; if the damage was a
   migration, the restore has un-run it — do NOT re-run it until the cause
   is understood); sign in as a real account; open a profile with media.
6. **Re-run what was lost, if it can be.** The daily cron's phases are
   idempotent (each re-derives from the tables); re-trigger it
   (`GET /api/cron/daily` with the `CRON_SECRET` bearer) so reminders,
   purges and mirrors catch up. Sport-event completions and org results
   written in the lost window must be re-entered by hand — the
   organizer's, from the ticket the incident opens.
7. **Write the incident down** in `DEVLOG.md`: the cause, the point chosen,
   the time from decision to healthy, what was re-entered.

**Restoring to a DIFFERENT project** (the drill, and the only safe way to
inspect a backup without overwriting prod): Supabase's "duplicate
project" / restore-to-new-project flow — Database → Backups → the backup →
"Restore to new project". That new project is what Round 2's staging
environment is.

## 5. The drill (Round 2, once staging exists)

Once a quarter, and once before the first org's first season:

1. Restore the latest production backup into the staging project (§4's
   last paragraph).
2. Point a local `.env.local` at staging; `npm run check:schema` → 0 drift.
3. Sign in as a QA user; open a profile; open a post with media (expect
   broken images unless Decision B is built — that is the finding, not a
   failure).
4. Record in `DEVLOG.md`: the date, the backup's timestamp, the wall-clock
   time from "restore" to "signed in", any drift.

The first drill is Round 2 item 5 of the plan
(`~/.claude/plans/let-s-go-ahead-and-linear-stallman.md`).

## 5b. The drill, first result (Sep 21 2026)

Not a backup restore — on a free-tier staging project there is none — but
the rebuild that stands in for it: a blank project (`EdgeAthlete-Staging`)
to the full schema at ledger head 227 in **~5 s per run** (three runs while
the generator was fixed; the checks — `check:schema`, the dump diff —
another minute). What it does NOT restore: rows, storage objects, auth
users. That is the shape of a real incident on the current tier: the
schema is minutes; the DATA is Decision A.

## 6. If the answer to §1 is "Free"

Until Decision A is made, the fallback is a manual logical dump — a
runbook step, not infrastructure:

```bash
# From a machine with the DB password (Supabase → Settings → Database).
pg_dump "$DATABASE_URL" --no-owner --no-privileges -Fc -f "edge-athlete-$(date +%F).dump"
```

Weekly, kept somewhere that is not the same laptop. A restore from it is
`pg_restore --clean --if-exists -d "$DATABASE_URL" <file>` into a FRESH
project, then `check:schema`. This is a stopgap; it has no Storage, no
automation and a week's RPO.
