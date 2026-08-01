# Security Audit — July 17, 2026

Full sweep of all 67 API routes for auth / authorization / privacy gaps
(RLS-bypassing admin client + missing checks). Trigger: two HIGH holes found
during feature work (`/api/profile`, `/api/golf/stats`).

## ✅ Fixed this session (10 total)

**HIGH (all were RLS-bypassing admin client + no auth):**
- `/api/profile` GET+PUT — IDOR write + PII leak (email/phone/GPA/SAT/DOB) → `b340147`
- `/api/golf/stats` GET — private performance data leak → `ec30cec`
- `/api/performances` POST + `/api/performances/[id]` DELETE — IDOR write/delete → `efabbeb`
- `/api/season-highlights` POST — IDOR upsert → `efabbeb`
- `/api/follow` POST — forge follows as any user → `efabbeb`
- `/api/posts/like` POST — forge likes as any user → `efabbeb`
- `/api/upload/avatar` POST — overwrite any user's avatar → `efabbeb`
- `/api/upload/post-media` DELETE — delete others' media → `efabbeb`
- `/api/equipment` GET — private athletes' equipment leak → `efabbeb`

Pattern applied everywhere: `requireAuth(request)`, derive the acting profile
from the **session** (never body/query), ownership check on mutations,
`canViewProfile()` on cross-profile reads, `if (error instanceof Response) return error` in catch.

> **Staleness note (Aug 2026):** this list has not been re-verified since
> 17 Jul 2026 and at least one open item below has since been fixed in code
> without being struck through here. Treat unresolved entries as *needs
> checking*, not as confirmed-live vulnerabilities.

## 🟡 MEDIUM findings

1. **`/api/suggestions` GET+POST** — takes `profileId`, returns connection
   suggestions (fallback reveals whom a user follows) + writes dismissals for
   an arbitrary profileId. Add `requireAuth` + `profileId === user.id`.
2. ~~**`/api/vitals` GET** — public profile leaked private training posts~~
   ✅ FIXED — non-owners get `.eq('visibility','public')` on training posts.
3. **`/api/upload` POST** — explicitly allows unauthenticated uploads to
   `temp/` (storage/cost abuse). Enforce `requireAuth`.
   *(Aug 2026: appears already fixed — the route now calls `requireAuth` and
   the `temp/` fallback is gone. Left listed pending a proper re-audit.)*
4. ~~**`/api/ai/text` + `/api/ai/image` POST** — unauthenticated paid OpenAI
   proxy (spend/abuse vector)~~ ✅ **RESOLVED PERMANENTLY (Aug 2026)** — both
   routes were deleted outright. They were unreferenced scaffolding and
   `OPENAI_API_KEY` was never set in Vercel; removing them also dropped the
   `openai` dependency. No auth check to regress.
5. **`/api/follow/stats` GET** — `currentUserId` caller-supplied/spoofable;
   data mostly public. Derive viewer from session.
6. **`/api/posts/[id]` GET** — returns a single post by id with no post/author
   `visibility` gate; a private post fetched by direct id would return. Add a
   privacy check if private-post confidentiality matters.

## 🔍 Postgres RPCs — verified July 17, 2026 (behavioral test vs live private profile)

**FOUND LEAKING — fixed at API layer (`bd1de44`):**
- `search_profiles` — returned private profiles. `/api/search` now filters public-or-own.
- `search_by_handle` — leaked private handle/name/avatar. `/api/handles/search` now drops private (non-own).
- `get_profile_*_media` — returned a private profile's media to anon. `/api/profile/[id]/media` now gates on profile visibility.

**Still to verify / defense-in-depth (SQL — user action):**
- The three RPCs above are patched at the API layer but STILL leak if called
  directly or from another caller. Fix them at the source — see
  `database/migrations/021_rpc_visibility_hardening.sql` (a starting point;
  the actual function bodies must be reviewed in the Supabase SQL Editor,
  since their definitions aren't in the repo).
- `search_posts`, `check_handle_availability`, `generate_connection_suggestions` —
  not yet behaviorally tested; verify they filter visibility.
- `suggestions` fallback path (non-RPC) already filters `visibility='public'`.

## 🟢 Confirmed OK
Notifications (all), messages (all), comments, posts CRUD, tags, sport-settings,
account/delete, privacy/check, golf scorecards/group-posts (cookie RLS client),
and intentionally-public routes (`/api/public/profile`, `/api/explore`,
`/api/search`, waitlist, signup) that return only public data.
