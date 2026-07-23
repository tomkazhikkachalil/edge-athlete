-- ============================================================================
-- Migration 026 — get_unread_message_count: floor unread at joined_at
-- ============================================================================
-- July 22, 2026 bug hunt (LOW): a participant with last_read_at = NULL was
-- charged for ALL messages in the conversation, including those sent before
-- they joined — a newly added group member's badge counted the entire
-- history. The unread floor is now the later of last_read_at and joined_at.
--
-- The route fallback (src/app/api/messages/unread-count/route.ts) and the
-- conversation-list unread computation were updated with the same semantics
-- in the same commit.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unread_message_count(p_user_id UUID)
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
    AND m.created_at > GREATEST(
      COALESCE(cp.last_read_at, cp.joined_at, '-infinity'::timestamptz),
      COALESCE(cp.joined_at, '-infinity'::timestamptz)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_message_count(UUID)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT public.get_unread_message_count(id) FROM public.profiles LIMIT 1;
--   → expect: a number, not an error
