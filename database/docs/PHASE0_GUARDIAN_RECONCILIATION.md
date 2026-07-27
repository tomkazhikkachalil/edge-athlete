# Phase 0 reconciliation — guardian-profiles feature (July 27, 2026)

Live-DB dump results (`database/phase0-guardian-live-dump.sql`, run by Tom in
the SQL editor) reconciled against the repo canon. These findings govern
migrations 048+.

## Findings

1. **`on_auth_user_created` trigger: DOES NOT EXIST live** (zero rows).
   The archive's `disable-signup-trigger.sql` did run at some point. No DROP
   needed in any guardian migration. The orphaned `handle_new_user()`
   function still exists (body: insert id/email/full_name ON CONFLICT DO
   NOTHING) — inert without the trigger; drop as hygiene whenever convenient.

2. **`follows` FKs both reference `profiles(id)` ON DELETE CASCADE**
   (`follows_follower_id_fkey`, `follows_following_id_fkey`). The archive
   variant FK'ing `auth.users` never made it to prod. No second identity
   coupling exists; minors' shadow identities can be followed normally.

3. **DB-only function bodies captured** (verbatim in the dump output;
   summarized):
   - `get_profile_all_media` / `get_profile_stats_media` /
     `get_profile_tagged_media` — SECURITY DEFINER, `search_path='public'`,
     6-arg (target, viewer, limit, offset, sport_keys[], years[]); privacy =
     public OR viewer-is-author OR viewer-is-target OR accepted-follow.
     **Rewritten by 051** to add the `status` predicate.
   - `get_profile_media_counts` — canonical body IS in the repo (migration
     022; force-drop-all-overloads pattern). **Rewritten by 051.**
   - `search_posts` — public-visibility full-text search. **Rewritten by 051**
     (`status='published'`).
   - `search_profiles` — full-text over ALL profiles with no visibility
     filter (returns private profiles' name/avatar/school; app layer is
     responsible for gating). Pre-existing behavior, noted; guardian-locked
     minors are forced `visibility='private'`, so any existing app-side
     handling of private profiles applies to them equally. Follow-up
     candidate outside this feature.
   - `can_view_profile` — own/public/accepted-follow. 052 adds the
     `profile_access` branch for parity with `src/lib/privacy.ts`.
   - `generate_connection_suggestions` — only `visibility='public'` profiles;
     locked minors (forced private) are excluded automatically. No change.
   - `update_user_handle` / `check_handle_availability` — as documented in
     006; `update_user_handle` refuses NULL→value (why handles are set at
     profile creation).

4. **Migrations 048–050 RUN + VERIFIED live** (PostgREST: profiles count ==
   owner self-row count; all five new tables reachable;
   `has_profile_access` callable).
