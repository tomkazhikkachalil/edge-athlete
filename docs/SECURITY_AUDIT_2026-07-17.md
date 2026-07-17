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

## 🟡 MEDIUM findings

1. **`/api/suggestions` GET+POST** — takes `profileId`, returns connection
   suggestions (fallback reveals whom a user follows) + writes dismissals for
   an arbitrary profileId. Add `requireAuth` + `profileId === user.id`.
2. ~~**`/api/vitals` GET** — public profile leaked private training posts~~
   ✅ FIXED — non-owners get `.eq('visibility','public')` on training posts.
3. **`/api/upload` POST** — explicitly allows unauthenticated uploads to
   `temp/` (storage/cost abuse). Enforce `requireAuth`.
4. ~~**`/api/ai/text` + `/api/ai/image` POST** — unauthenticated paid OpenAI
   proxy (spend/abuse vector)~~ ✅ FIXED — both now `requireAuth` (no callers
   in the app; starter scaffolding).
5. **`/api/follow/stats` GET** — `currentUserId` caller-supplied/spoofable;
   data mostly public. Derive viewer from session.
6. **`/api/posts/[id]` GET** — returns a single post by id with no post/author
   `visibility` gate; a private post fetched by direct id would return. Add a
   privacy check if private-post confidentiality matters.

## 🔍 Postgres RPCs to verify (privacy delegated to SQL, invoked via admin client)

These bypass RLS via the admin client and delegate privacy to the function
body — **confirm each filters `visibility='public'` (or the viewer):**
- `search_profiles`, `search_posts` (`/api/search`)
- `search_by_handle`, `check_handle_availability` (`/api/handles/*`)
- `get_profile_all_media`, `get_profile_stats_media`, `get_profile_tagged_media` (`/api/profile/[id]/media`)
- `generate_connection_suggestions` (`/api/suggestions`)

## 🟢 Confirmed OK
Notifications (all), messages (all), comments, posts CRUD, tags, sport-settings,
account/delete, privacy/check, golf scorecards/group-posts (cookie RLS client),
and intentionally-public routes (`/api/public/profile`, `/api/explore`,
`/api/search`, waitlist, signup) that return only public data.
