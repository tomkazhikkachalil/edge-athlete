-- ============================================================================
-- Migration 040 — Supabase security-linter remediation
-- ============================================================================
-- Fixes the July 25 database linter findings. Verified against the codebase
-- before writing:
--   • notifications are inserted ONLY via the service role (messages route,
--     group-notifications lib) and SECURITY DEFINER triggers → the wide-open
--     authenticated INSERT policy is dead weight and lets any signed-in user
--     forge notifications for anyone. Dropped.
--   • No client code lists the avatars/uploads buckets (equipment uploads go
--     to 'media'); public-object URL access does NOT need a SELECT policy →
--     the listing policies are dropped.
--   • Trigger functions never need caller EXECUTE (privilege is checked at
--     CREATE TRIGGER time) → revoked from anon/authenticated.
--   • Server-only RPCs (called with the service role in API routes) →
--     revoked from anon/authenticated.
--   • get_unread_message_count IS called with the user client
--     (messages/unread-count route) → keep authenticated, revoke anon.
--   • RLS helper functions (is_group_post_*, is_conversation_participant)
--     MUST stay executable by anon+authenticated — policies evaluate them as
--     the querying role. Their linter warnings are ACCEPTED by design.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- Idempotent. No deploy needed.
-- Dashboard items NOT fixable in SQL (do these in the dashboard):
--   1. Auth → Providers/Settings → enable Leaked Password Protection
--   2. Settings → Infrastructure → upgrade Postgres (security patches;
--      brief downtime — do it at a quiet moment)
-- ============================================================================

-- ── 1. Pin search_path on flagged functions ─────────────────────────────────
-- Pinned to 'public' (not '') because these bodies use unqualified table
-- names; pinning removes the hijack risk without rewriting bodies.
ALTER FUNCTION public.update_equipment_updated_at() SET search_path = 'public';
ALTER FUNCTION public.update_conversation_on_message() SET search_path = 'public';
ALTER FUNCTION public.is_conversation_participant(uuid, uuid) SET search_path = 'public';
ALTER FUNCTION public.get_profile_all_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_tagged_media(uuid, uuid, integer, integer, text[], integer[]) SET search_path = 'public';
ALTER FUNCTION public.get_profile_media_counts(uuid, uuid) SET search_path = 'public';

-- ── 2. Notifications: drop the forge-anything INSERT policy ─────────────────
DROP POLICY IF EXISTS notifications_insert_policy ON public.notifications;

-- ── 3. Storage: public buckets stop allowing listing ────────────────────────
-- Object URLs on public buckets work without any SELECT policy.
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Public Access Uploads" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for uploads" ON storage.objects;

-- ── 4. Trigger functions: not callable via RPC ──────────────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'update_equipment_updated_at',
    'update_conversation_on_message',
    'handle_new_user',
    'notify_comment_like',
    'notify_follow_accepted',
    'notify_follow_declined',
    'notify_follow_request',
    'notify_new_follower',
    'notify_post_comment',
    'notify_post_like',
    'notify_profile_tagged',
    'update_post_comments_count',
    'update_post_likes_count'
  ] LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skipping missing function %', fn;
    END;
  END LOOP;
END $$;

-- ── 5. Server-only RPCs: not callable by API roles ──────────────────────────
REVOKE EXECUTE ON FUNCTION public.can_view_profile(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_notifications() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, uuid, text, text, text, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_actor_display_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_all_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_stats_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_tagged_media(uuid, uuid, integer, integer, text[], integer[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_media_counts(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_tagged_posts(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_unread_notification_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon, authenticated;

-- ── 6. User-client RPC: keep authenticated, drop anon ───────────────────────
REVOKE EXECUTE ON FUNCTION public.get_unread_message_count(uuid) FROM PUBLIC, anon;

-- ── 7. RLS helpers: grants INTENTIONALLY kept (accepted linter warnings) ────
-- is_group_post_creator/participant/organizer + is_conversation_participant
-- are evaluated inside RLS policies as the querying role; revoking EXECUTE
-- would break row visibility for every group-round and messaging query.

-- ── Verification (run after) ────────────────────────────────────────────────
-- Re-run the Database Linter: expect the search_path, notifications-policy,
-- bucket-listing, and all trigger/server-RPC SECURITY DEFINER warnings gone;
-- ONLY the four RLS-helper warnings remain (accepted).
-- Functional smoke: send a message (notification still arrives — service
-- role path), load a profile's media tabs (admin-client RPCs), check unread
-- message badge (authenticated RPC), avatars still render (public URLs).
