# Runbook: Apply Migrations 014–017 to Supabase

This runbook walks through applying four pending migrations to your Supabase Postgres database. Each step has **pre-check SQL** (run before to confirm the migration is needed) and **post-check SQL** (run after to confirm it landed correctly).

**All four migrations are idempotent** — they use `IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, and `DROP TRIGGER IF EXISTS` patterns, so accidentally re-running one is safe.

---

## How to use this runbook

1. Open the Supabase Dashboard → your project → **SQL Editor**.
2. For each migration in order (014 → 015 → 016 → 017):
   - Paste the **pre-check** query, click **Run**. Confirm the output matches "expected before".
   - Open the migration file (`database/migrations/0XX_*.sql` in this repo), copy its full contents, paste into the SQL Editor, and click **Run**.
   - Paste the **post-check** query, click **Run**. Confirm the output matches "expected after".
   - Optional: do the **smoke test** in the live app to verify the user-visible payoff.

If any post-check returns the wrong output, **stop and report back** — don't proceed to the next migration.

---

## At-a-glance status (run anytime)

Paste this single query first to see which migrations are currently applied. You can re-run it at any point during the runbook to recheck progress.

```sql
SELECT
  -- 014: helper function is the canary
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_actor_display_name')
    AS m014_applied,

  -- 015: counts trigger is the canary
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_likes_count' AND NOT tgisinternal
  ) AS m015_applied,

  -- 016: is_pinned column on post_comments
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'post_comments'
      AND column_name = 'is_pinned'
  ) AS m016_applied,

  -- 017: parent_message_id column on messages
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'parent_message_id'
  ) AS m017_applied;
```

**Expected before any migrations are applied**: all four columns return `false`.
**Expected after the runbook is complete**: all four return `true`.

---

## Migration 014 — Fix notification actor name format

### Goal
Replaces five trigger functions that build notification text. The old versions used `first_name || ' ' || last_name` which silently returns `NULL` if either name is null in Postgres, causing notifications to fall back to `full_name` (which may be a handle like `JohnDoe` instead of a display name). The new versions handle each name part individually and trim/coalesce gracefully.

Adds a new helper function `public.get_actor_display_name(uuid)` and recreates triggers on `follows`, `post_likes`, and `post_comments`.

### Pre-check
```sql
SELECT
  -- Should be FALSE before applying
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_actor_display_name')
    AS helper_exists;
```
**Expected before**: `helper_exists` = `false`.

### Apply
1. Open `database/migrations/014_fix_notification_actor_name.sql` in your editor.
2. Copy the entire file contents.
3. Paste into Supabase SQL Editor → click **Run**.
4. You should see no errors. The query may take 1–2 seconds (it recreates several functions and triggers).

### Post-check
```sql
SELECT
  -- All should be TRUE after applying
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_actor_display_name')
    AS helper_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_notify_follow_request' AND NOT tgisinternal
  ) AS follow_request_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_notify_follow_accepted' AND NOT tgisinternal
  ) AS follow_accepted_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_notify_new_follower' AND NOT tgisinternal
  ) AS new_follower_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_notify_post_like' AND NOT tgisinternal
  ) AS post_like_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_notify_post_comment' AND NOT tgisinternal
  ) AS post_comment_trigger;
```
**Expected after**: all six columns = `true`.

You can also spot-check the helper directly:
```sql
-- Pick any real profile id from your DB
SELECT public.get_actor_display_name(
  (SELECT id FROM public.profiles LIMIT 1)
) AS sample_name;
```
**Expected**: returns a non-null string (a real user's display name or `'Someone'`).

### Smoke test (optional, in the live app)
- Have one user follow another from a private profile (creates a `follow_request` notification).
- The recipient's notifications dropdown should show the sender's first+last name (or first-only / full_name fallback) — never a `NULL` or a raw handle.

---

## Migration 015 — Like / comment count consistency triggers + one-time recount

### Goal
Adds Postgres-side triggers that keep `posts.likes_count` and `posts.comments_count` in sync with the actual rows in `post_likes` and `post_comments`. The API already recounts after each operation, but these triggers serve as defense-in-depth for any direct DB inserts/deletes (e.g., from admin tooling or future migrations).

Also runs a **one-time recount** for every existing post, fixing any drift that's accumulated.

### Pre-check
```sql
SELECT
  -- Should be FALSE before applying
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_likes_count' AND NOT tgisinternal
  ) AS likes_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_comments_count' AND NOT tgisinternal
  ) AS comments_trigger;
```
**Expected before**: both = `false`.

Optional — peek at how much drift you currently have (rows with cached count != actual):
```sql
SELECT
  COUNT(*) AS posts_with_stale_likes_count
FROM public.posts p
WHERE p.likes_count <> (
  SELECT COUNT(*) FROM public.post_likes WHERE post_id = p.id
);

SELECT
  COUNT(*) AS posts_with_stale_comments_count
FROM public.posts p
WHERE p.comments_count <> (
  SELECT COUNT(*) FROM public.post_comments WHERE post_id = p.id
);
```
A non-zero result here means the cached counts are wrong; the migration's one-time recount will fix them.

### Apply
1. Open `database/migrations/015_fix_like_comment_count_triggers.sql`.
2. Copy and paste into Supabase SQL Editor → **Run**.
3. The recount step (`UPDATE posts SET likes_count = …`) will touch every row in `posts`. On a small DB it's instant; on a larger one (10k+ posts) it could take a few seconds.

### Post-check
```sql
SELECT
  -- All should be TRUE after applying
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_likes_count' AND NOT tgisinternal
  ) AS likes_trigger,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_comments_count' AND NOT tgisinternal
  ) AS comments_trigger,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_post_likes_count')
    AS likes_function,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_post_comments_count')
    AS comments_function;
```
**Expected after**: all four = `true`.

Re-run the drift queries from the pre-check — both should now return `0`:
```sql
SELECT
  COUNT(*) AS posts_with_stale_likes_count
FROM public.posts p
WHERE p.likes_count <> (
  SELECT COUNT(*) FROM public.post_likes WHERE post_id = p.id
);
```
**Expected**: `0`.

### Smoke test (optional)
- Like a post in the app, then look at the post's like count — should be exactly correct.
- Unlike it — count decrements correctly.

---

## Migration 016 — Comment pinning support

### Goal
Adds a single boolean column `is_pinned` to `post_comments`, plus a partial index for fast lookup of the pinned comment per post. The post owner can pin one comment; this is enforced at the API layer.

This is the smallest of the four migrations.

### Pre-check
```sql
SELECT
  -- Should be FALSE before applying
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'post_comments'
      AND column_name = 'is_pinned'
  ) AS column_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_post_comments_is_pinned'
  ) AS index_exists;
```
**Expected before**: both = `false`.

### Apply
1. Open `database/migrations/016_comment_pinning.sql`.
2. Copy and paste into Supabase SQL Editor → **Run**.
3. Should complete in well under a second.

### Post-check
```sql
SELECT
  -- Both should be TRUE after applying
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'post_comments'
      AND column_name = 'is_pinned'
  ) AS column_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_post_comments_is_pinned'
  ) AS index_exists;
```
**Expected after**: both = `true`.

Confirm the column has the expected default:
```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'post_comments'
  AND column_name = 'is_pinned';
```
**Expected**: `data_type = 'boolean'`, `column_default = 'false'`, `is_nullable = 'YES'`.

### Smoke test (optional)
- As the owner of a post, open the post's comments and click the pin icon on one of them.
- Refresh — that comment should appear at the top, marked as pinned.
- Pin a different comment — the previous one should unpin (API enforces single pin per post).

---

## Migration 017 — Message reactions schema (parent_message_id, gif_reaction type, indexes)

### Goal
Schema needed for the GIF/emoji reactions feature already shipped in the messaging UI. Adds:
- `messages.parent_message_id` — FK back to `messages.id` so a GIF sent as a reaction can be linked to its parent message.
- Expands the `messages_type_check` CHECK constraint to allow `'gif_reaction'` as a message type.
- Index on `messages(parent_message_id)` for fetching reactions by parent.
- Index on `message_reactions(message_id)` for fetching emoji reactions by message (file note says this was missing from `012_messaging.sql`).

**This is the most user-impacting of the four** — without it, `/api/messages/.../reactions` and the GIF-reaction send path will fail with constraint violations or missing-column errors.

### Pre-check
```sql
-- Prerequisite: confirm 012_messaging.sql is applied (message_reactions table exists)
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'messages'
  ) AS messages_table_exists,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'message_reactions'
  ) AS message_reactions_table_exists;
```
**Expected before**: both must be `true` (012_messaging.sql is a hard prerequisite for 017). If `message_reactions_table_exists` is `false`, you need to apply `012_messaging.sql` first — stop and report back.

Then check that 017's specific artifacts are NOT yet present:
```sql
SELECT
  -- Should all be FALSE before applying
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'parent_message_id'
  ) AS parent_col_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_messages_parent'
  ) AS parent_index_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_message_reactions_message'
  ) AS reactions_index_exists,
  -- Check whether 'gif_reaction' is already in the type CHECK constraint
  (SELECT pg_get_constraintdef(oid)
     FROM pg_constraint
     WHERE conname = 'messages_type_check')
    AS current_type_check;
```
**Expected before**: first three = `false`. The `current_type_check` text should NOT include `'gif_reaction'`.

### Apply
1. Open `database/migrations/017_message_reactions.sql`.
2. Copy and paste into Supabase SQL Editor → **Run**.
3. Should complete in well under a second on a small DB.

### Post-check
```sql
SELECT
  -- All should be TRUE after applying
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'parent_message_id'
  ) AS parent_col_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_messages_parent'
  ) AS parent_index_exists,
  EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_message_reactions_message'
  ) AS reactions_index_exists;
```
**Expected after**: all three = `true`.

Confirm the CHECK constraint now includes `'gif_reaction'`:
```sql
SELECT pg_get_constraintdef(oid) AS type_check_def
FROM pg_constraint
WHERE conname = 'messages_type_check';
```
**Expected**: the returned text should contain `'gif_reaction'` alongside `'text'`, `'image'`, `'video'`, `'shared_post'`, `'shared_profile'`. Example output:
```
CHECK ((type = ANY (ARRAY['text'::text, 'image'::text, 'video'::text, 'shared_post'::text, 'shared_profile'::text, 'gif_reaction'::text])))
```

Confirm FK to `messages.id` is wired up:
```sql
SELECT
  conname AS constraint_name,
  confdeltype AS on_delete_action
FROM pg_constraint
WHERE conrelid = 'public.messages'::regclass
  AND confrelid = 'public.messages'::regclass
  AND conname LIKE '%parent_message_id%';
```
**Expected**: one row, `on_delete_action = 'c'` (cascade).

### Smoke test (optional)
- Open a 1:1 conversation in the app.
- Send a normal message.
- Long-press / hover the message → tap the GIF-reaction button → pick a GIF.
- The GIF should appear nested under the parent message and persist across page reload.
- Tap an emoji on a message → the count should increment, persist, and be visible to the other user in real time.

---

## After all four migrations are applied

Re-run the at-a-glance status query at the top of this file. All four columns should return `true`.

```sql
SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_actor_display_name')
    AS m014_applied,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trigger_update_post_likes_count' AND NOT tgisinternal
  ) AS m015_applied,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'post_comments'
      AND column_name = 'is_pinned'
  ) AS m016_applied,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'messages'
      AND column_name = 'parent_message_id'
  ) AS m017_applied;
```

**Expected**: `t | t | t | t`.

---

## Rollback notes

These migrations are forward-only by design. Most of the changes are not trivially reversible without losing data. If you need to roll back a specific migration:

- **014** — restore the previous trigger definitions from earlier migrations (e.g., `003_notifications.sql`). The bug they introduce is cosmetic (notification text), not data-corrupting.
- **015** — `DROP TRIGGER trigger_update_post_likes_count ON post_likes; DROP FUNCTION update_post_likes_count;` (and same for comments). The cached counts will go back to drifting but no data is lost.
- **016** — `DROP INDEX idx_post_comments_is_pinned; ALTER TABLE post_comments DROP COLUMN is_pinned;` — destructive (loses any pinned-comment state, but since the feature is new there should be none yet).
- **017** — most invasive to roll back: would require dropping the `parent_message_id` column (cascade-deletes all GIF reactions stored as child messages) and reverting the CHECK constraint. Don't roll back unless absolutely necessary.

If a post-check fails partway through, **stop and report the actual output** rather than rolling back blindly.

---

## What's enabled when this is done

- ✅ **Notifications** show real first/last names instead of falling back to handles for users with partial profile data (014).
- ✅ **Post like + comment counts** stay accurate even if any future code path touches `post_likes`/`post_comments` directly (015).
- ✅ **Comment pinning** works in the UI — owners can pin one comment per post (016).
- ✅ **Emoji + GIF reactions in chat** work without 500 errors (017). This is the feature most likely to break in production today, since the UI is already shipped.

After confirming all four migrations are applied, ping back and we'll move on to the P1 silent-catch sweep.
