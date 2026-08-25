-- ============================================================================
-- Migration 124 — get_conversation_list RPC (collapse the O(2N) inbox query)
-- ============================================================================
-- GET /api/messages assembled a user's conversation list with 2 bulk queries
-- plus TWO per-conversation loops: one limit-1 "last message" query per
-- conversation and one "unread count" query per conversation — O(2N) round
-- trips on a ~30s background poll. This function returns the fully-assembled
-- list in ONE call.
--
-- Output: a jsonb ARRAY of conversation objects, ordered updated_at DESC. Each
-- object matches the wire shape the route returned before (types/messages.ts
-- Conversation): conversation core + participants[] (with embedded profile) +
-- last_message (latest non-deleted, with sender) + unread_count + my_participant.
-- The route still runs last_message.media_url through toProxyUrl afterwards, so
-- this returns the RAW stored media_url (crypto/proxy stays in app code).
--
-- Unread floor mirrors the route EXACTLY: the later of last_read_at and
-- joined_at (a newly-added group member is not charged for prior history).
-- GREATEST() ignores NULLs, so a null last_read_at collapses to joined_at.
--
-- ⚠️ SECURITY: this takes p_user_id as a parameter and does NOT check it
-- against auth.uid(), so it must NEVER be directly callable by an end user —
-- that would let any authenticated user read anyone's conversations (IDOR).
-- EXECUTE is granted to service_role ONLY; the route calls it with the admin
-- client after requireAuth, always passing the caller's OWN id. Do not add an
-- `authenticated` grant here.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

-- 1. Drop any overload that might exist (defensive; expected: none).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'get_conversation_list'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

-- 2. Create the single correct definition.
CREATE FUNCTION public.get_conversation_list(p_user_id UUID)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH my_convs AS (
    SELECT cp.conversation_id, cp.last_read_at, cp.joined_at
    FROM public.conversation_participants cp
    WHERE cp.profile_id = p_user_id
      AND cp.left_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(sub.conv_json ORDER BY sub.updated_at DESC), '[]'::jsonb)
  FROM (
    SELECT
      c.updated_at,
      jsonb_build_object(
        'id', c.id,
        'type', c.type,
        'name', c.name,
        'avatar_url', c.avatar_url,
        'created_by', c.created_by,
        'created_at', c.created_at,
        'updated_at', c.updated_at,
        -- All active participants (for avatars/names; the client derives the
        -- "other" participant of a DM from this).
        'participants', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', pp.id,
            'conversation_id', pp.conversation_id,
            'profile_id', pp.profile_id,
            'role', pp.role,
            'last_read_at', pp.last_read_at,
            'is_muted', pp.is_muted,
            'joined_at', pp.joined_at,
            'left_at', pp.left_at,
            'profile', jsonb_build_object(
              'id', pr.id,
              'first_name', pr.first_name,
              'last_name', pr.last_name,
              'full_name', pr.full_name,
              'avatar_url', pr.avatar_url,
              'handle', pr.handle
            )
          ))
          FROM public.conversation_participants pp
          JOIN public.profiles pr ON pr.id = pp.profile_id
          WHERE pp.conversation_id = c.id
            AND pp.left_at IS NULL
        ), '[]'::jsonb),
        -- Latest non-deleted message, with its sender's profile.
        'last_message', (
          SELECT jsonb_build_object(
            'id', m.id,
            'conversation_id', m.conversation_id,
            'sender_id', m.sender_id,
            'type', m.type,
            'content', m.content,
            'media_url', m.media_url,
            'media_type', m.media_type,
            'shared_post_id', m.shared_post_id,
            'shared_profile_id', m.shared_profile_id,
            'deleted_at', m.deleted_at,
            'created_at', m.created_at,
            'updated_at', m.updated_at,
            'sender', jsonb_build_object(
              'id', sp.id,
              'first_name', sp.first_name,
              'last_name', sp.last_name,
              'full_name', sp.full_name,
              'avatar_url', sp.avatar_url,
              'handle', sp.handle
            )
          )
          FROM public.messages m
          JOIN public.profiles sp ON sp.id = m.sender_id
          WHERE m.conversation_id = c.id
            AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC
          LIMIT 1
        ),
        -- Messages from OTHERS after the unread floor (later of last_read_at
        -- and joined_at). GREATEST ignores NULLs → null last_read_at = joined_at.
        'unread_count', (
          SELECT count(*)
          FROM public.messages um
          WHERE um.conversation_id = c.id
            AND um.sender_id <> p_user_id
            AND um.deleted_at IS NULL
            AND (
              GREATEST(mc.last_read_at, mc.joined_at) IS NULL
              OR um.created_at > GREATEST(mc.last_read_at, mc.joined_at)
            )
        ),
        'my_participant', jsonb_build_object(
          'id', myp.id,
          'conversation_id', myp.conversation_id,
          'profile_id', myp.profile_id,
          'role', myp.role,
          'last_read_at', myp.last_read_at,
          'is_muted', myp.is_muted,
          'joined_at', myp.joined_at,
          'left_at', myp.left_at,
          'profile', jsonb_build_object(
            'id', mypr.id,
            'first_name', mypr.first_name,
            'last_name', mypr.last_name,
            'full_name', mypr.full_name,
            'avatar_url', mypr.avatar_url,
            'handle', mypr.handle
          )
        )
      ) AS conv_json
    FROM my_convs mc
    JOIN public.conversations c ON c.id = mc.conversation_id
    JOIN public.conversation_participants myp
      ON myp.conversation_id = c.id
     AND myp.profile_id = p_user_id
     AND myp.left_at IS NULL
    JOIN public.profiles mypr ON mypr.id = p_user_id
  ) sub;
$$;

-- 3. Lock down EXECUTE. Postgres grants EXECUTE to PUBLIC by default on EVERY
--    new function, so a bare GRANT to service_role is NOT enough — anon and
--    authenticated still inherit PUBLIC's grant and can call this directly via
--    PostgREST with ANY p_user_id (IDOR — dump anyone's inbox with the public
--    anon key). REVOKE from PUBLIC first, then grant to service_role only.
--    Same class as the 085/086 handle-takeover revokes. Re-running the whole
--    migration is safe: the recreate above re-adds the PUBLIC default, and
--    these REVOKEs strip it again.
REVOKE ALL ON FUNCTION public.get_conversation_list(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversation_list(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_list(UUID) TO service_role;

-- 4. Refresh PostgREST's schema cache so the RPC is visible immediately.
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT public.get_conversation_list(id) FROM public.profiles LIMIT 1;
--   → expect: a jsonb array (possibly []), not an error.
