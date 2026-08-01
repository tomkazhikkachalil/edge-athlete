# Security Audit — July 17, 2026 · re-verified August 1, 2026

**Route count: 67 at the original audit → 107 at re-verification.** That number is
recorded deliberately: the reason 43 routes went unaudited for two weeks is that nobody
could see the surface had grown. If it has moved again since, this document is out of date
by exactly that much.

**How to read this.** Every claim below states its *method*, because the strength of a
finding is the strength of how it was checked:

| tag | means |
|---|---|
| **[anon]** | probed live with the public anon key — the bypass an attacker gets for free |
| **[auth]** | probed live as a signed-in stranger (disposable account, non-follower, non-participant) |
| **[code]** | read the implementation; not exercised at runtime |
| **[test]** | pinned by an automated test that fails if it regresses |

---

## ✅ Original HIGH findings — fixed July 17 (10 total)

All were RLS-bypassing admin client + no auth: `/api/profile` GET+PUT (IDOR write + PII
leak) `b340147` · `/api/golf/stats` `ec30cec` · `/api/performances` POST + `[id]` DELETE,
`/api/season-highlights` POST, `/api/follow` POST, `/api/posts/like` POST,
`/api/upload/avatar` POST, `/api/upload/post-media` DELETE, `/api/equipment` GET `efabbeb`.

Pattern applied: `requireAuth(request)`, derive the acting profile from the **session**
(never body/query), ownership check on mutations, `canViewProfile()` on cross-profile
reads, `if (error instanceof Response) return error` in catch.

## ✅ MEDIUM findings — all four RESOLVED (re-verified Aug 1)

The July list carried these as open. **All four were already fixed in code**; the document
had simply not been updated.

1. **`/api/suggestions`** — `requireAuth` + `profileId !== user.id` → 403; POST derives
   `profileId` from the session. **[code]** **[auth]** stranger requesting another
   profile's suggestions → **403**.
2. **`/api/vitals`** — non-owners get `.eq('visibility','public')` on training posts. **[code]**
3. **`/api/upload`** — `requireAuth` enforced; the anonymous `temp/` path is gone. **[code]**
4. **`/api/ai/text` + `/api/ai/image`** — **deleted outright** (Aug 2026). Unreferenced
   scaffolding; `OPENAI_API_KEY` was never set in Vercel. Dropped the `openai` dependency
   too. No auth check left to regress.
5. **`/api/follow/stats`** — viewer derived from the session; the query param is ignored. **[code]**
6. **`/api/posts/[id]`** — private posts gated by `canViewProfile`, returning **404 not
   403** so the response doesn't confirm the post exists. **[auth]** verified against a
   purpose-created private post owned by a disposable user: stranger → **404**, no caption
   in the body.

## ✅ Postgres RPCs — the direct-call bypass does NOT reproduce

The July audit patched three RPCs at the API layer and warned they "STILL leak if called
directly." That was the right worry — the anon key is public, so anyone can call an RPC
from a browser console and skip the API entirely.

Tested against production with **16 profiles, 8 of them private** as ground truth
(service-role read), calling each function directly:

| RPC | **[anon]** | **[auth]** stranger |
|---|---|---|
| `search_by_handle` | 2 rows, **0 private** | 2 rows, **0 private** |
| `search_profiles` | matched rows, **0 private** | 1 row, **0 private** |
| `search_posts` | 4 rows, **0 private** | 4 rows, **0 private** |
| `generate_connection_suggestions` (arbitrary `p_user_profile_id`) | 8 rows, **0 private** | 8 rows, **0 private** |
| `get_profile_media_counts` (private target, null viewer) | all-zero | — |
| `check_handle_availability` | availability only, no PII | — |

**Caveat, stated plainly:** this is behavioural evidence, not a source review. The function
bodies are not in the repo, so *why* they filter correctly has not been read — only *that*
they do, on this data, today. A reviewer with Supabase SQL Editor access should still read
`search_profiles`, `search_by_handle` and `get_profile_*_media` to confirm the filter is in
the function rather than incidental to current rows.

## ✅ Routes added after the original audit (43) — first review Aug 1

Includes the most sensitive surfaces in the product: guardian (minors' data, credentials,
consent), admin, cron, transfers, invites, and a token-addressed public calendar feed.

- **admin ×5** — all `requireAdmin`. **[test]** fail-closed contract pinned in
  `src/lib/__tests__/admin-allowlist.test.ts`; **[auth]** stranger → 403 on
  `/api/admin/users`, `/api/admin/reports`, `/api/admin/storage-sweep`.
- **cron ×4** — all verify `CRON_SECRET`. **[auth]** `/api/cron/daily` without the secret → 401.
- **guardian ×5 + transfers ×2** — all use `getProfileRole(user.id, profileId)`, real
  authorization not just authentication. **[test]** the role × action matrix is exhaustively
  covered in `profile-roles.test.ts`. **[auth]** stranger → 404 on `DELETE
  /api/guardian/athletes/<id>`, `GET .../consent`, `POST .../credentials`, and the target
  profile was confirmed **intact** after the destructive attempt.
- **capability tokens** (`invites/[token]`, `calendar/feed/[token]`) — **[code]**
  `randomBytes(32).toString('base64url')`, **sha256 at rest**, raw value shown once.
  **[auth]** bogus token → 404 on both.
- **`auth/username-login`** — **[code]** uniform `Invalid username or password` (no account
  enumeration), IP+username rate limited, hard-rejects non-supervised profiles, behind
  `FEATURE_GUARDIAN_PROFILES`.

## 🟡 Accepted risk — open, with rationale

**`/api/profile/[profileId]/active-sports`** — admin client, no auth. Reveals *which sports*
a profile plays, including a private one. The route header argues sport keys are not
sensitive and the endpoint returns no post content, counts or dates. That is defensible for
this product, so it is **accepted, not fixed** — recorded here so the decision is visible
rather than looking like an oversight. Revisit if sport participation ever becomes
inferable-sensitive (e.g. a sport implying a protected characteristic).

## 🟢 Confirmed OK
Notifications, messages, comments, posts CRUD, tags, sport-settings, account/delete,
privacy/check, golf scorecards/group-posts (cookie RLS client), and intentionally-public
routes (`/api/public/profile`, `/api/explore`, `/api/search`, waitlist, signup, health)
that return only public data.

---

## Re-running this

The **[anon]** and **[auth]** probes are reproducible: create a disposable victim
(auth user **plus** an explicit `profiles` row — `createUser` alone does not make one, and
probing a non-existent profile passes vacuously) and a disposable stranger, mint a session,
probe, then delete both and confirm deletion by service-role lookup rather than trusting
the delete's status code.

**Nothing in this pass required a code fix.** Working auth code was left alone; the only
source change was extracting `isAdminEmail` so its fail-closed behaviour could be tested.
