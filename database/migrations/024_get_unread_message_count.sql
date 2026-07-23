-- ============================================================================
-- Migration 024 — Create get_unread_message_count RPC (was never defined)
-- ============================================================================
-- Found during the migration-023 verification sweep (July 22, 2026):
-- /api/messages/unread-count calls rpc('get_unread_message_count') but the
-- function was never created in any migration. Nothing looked broken because
-- the route has a manual fallback — but that means EVERY unread-badge poll
-- silently errors (PGRST202), then runs an N+1 loop: one COUNT query per
-- conversation, per poll. This migration replaces that with one aggregate.
--
-- Semantics match the route's fallback exactly
-- (src/app/api/messages/unread-count/route.ts):
--   messages in the user's active conversations (left_at IS NULL),
--   not sent by the user, not soft-deleted, newer than last_read_at
--   (all of them if last_read_at is NULL).
--
-- No code deploy needed: the route already prefers the RPC and only falls
-- back on error. Once this runs, the fast path takes over automatically.
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
    WHERE proname = 'get_unread_message_count'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

-- 2. Create the single correct definition.
--    SECURITY DEFINER + empty search_path (all references fully qualified),
--    per the schema-qualified-functions convention.
CREATE FUNCTION public.get_unread_message_count(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)
  FROM public.conversation_participants cp
  JOIN public.messages m
    ON m.conversation_id = cp.conversation_id
  WHERE cp.profile_id = p_user_id
    AND cp.left_at IS NULL
    AND m.sender_id <> p_user_id
    AND m.deleted_at IS NULL
    AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at);
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_message_count(UUID)
  TO authenticated, service_role;

-- 3. Refresh PostgREST's schema cache so the RPC is visible immediately.
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT public.get_unread_message_count(id) FROM public.profiles LIMIT 1;
--   → expect: a number (0 is fine), not an error
