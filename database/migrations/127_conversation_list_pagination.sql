-- ============================================================================
-- Migration 127 — get_conversation_list pagination (extends 124 IN PLACE)
-- ============================================================================
-- 124's RPC assembled the WHOLE inbox in one call — right fix for the O(2N)
-- round trips, still unpaginated. This adds defaulted params so the
-- CURRENTLY-DEPLOYED route (which calls with p_user_id only) keeps working
-- through the migrate→deploy skew window:
--   p_limit  int         DEFAULT NULL   -- NULL = unlimited (124 behavior)
--   p_before timestamptz DEFAULT NULL   -- cursor: conversations updated
--                                       -- strictly BEFORE this instant
-- The route requests p_limit+1 to derive has_more; next_cursor is the last
-- returned conversation's updated_at. The cursor is updated_at ALONE, no id
-- tiebreak, ON PURPOSE: the sort key mutates as messages arrive, so deep
-- pagination is inherently fuzzy — the client merges by id and dedupes, which
-- absorbs both ties and bumped conversations. Wire shape per element is
-- byte-identical to 124.
--
-- ⚠️ SECURITY unchanged from 124: p_user_id is trusted, so EXECUTE stays
-- service_role-ONLY (REVOKE PUBLIC first — Postgres re-grants PUBLIC on every
-- recreate; the 124/085/086 lesson).
--
-- ⚠️ Supabase SQL Editor: run the WHOLE file; expect green "Success".
-- Re-runnable (drop-overloads block).
-- ============================================================================

-- 1. Drop every overload (124's single-arg version included).
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

-- 2. Recreate with pagination params (body identical to 124 except the
--    WHERE/ORDER/LIMIT marked NEW below).
CREATE FUNCTION public.get_conversation_list(
  p_user_id UUID,
  p_limit integer DEFAULT NULL,
  p_before timestamptz DEFAULT NULL
)
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
    WHERE (p_before IS NULL OR c.updated_at < p_before)  -- NEW: cursor
    ORDER BY c.updated_at DESC                           -- NEW: page order
    LIMIT p_limit                                        -- NEW: NULL = all
  ) sub;
$$;

-- 3. Lock down EXECUTE (recreate re-granted PUBLIC — strip it again).
REVOKE ALL ON FUNCTION public.get_conversation_list(UUID, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversation_list(UUID, integer, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_list(UUID, integer, timestamptz) TO service_role;

-- 4. Refresh PostgREST's schema cache.
NOTIFY pgrst, 'reload schema';

-- ── Verification ────────────────────────────────────────────────────────────
-- Expect: fn true with 3 args, and the two calls below both return jsonb
-- arrays (the first possibly longer; the second at most 2 elements).
SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_conversation_list' AND pronargs = 3) AS fn_three_args;
-- SELECT public.get_conversation_list(id) FROM public.profiles LIMIT 1;
-- SELECT public.get_conversation_list(id, 2, NULL) FROM public.profiles LIMIT 1;
