-- ============================================================================
-- 131: first-contact hold — approved_contacts + held participants (W3)
-- ============================================================================
-- Tom's locked decision ③: the first message from ANY account with no prior
-- approved contact and no accepted follow reaches a supervised child only
-- after a guardian approves. The audit hole this closes: send-time re-checks
-- keyed on the SENDER being supervised, so an adult sending into an existing
-- DM with a child was never re-checked.
--
--   * approved_contacts — the per-child contact ledger. Auto-approved
--     sources: 'grandfathered' (backfill below), 'guardian' (sender is the
--     child's guardian), 'follow' (accepted follow either direction),
--     'child_initiated' (the child started it — visibility, not lockdown).
--     'guardian_decision' rows come from the console queue's Approve/Deny.
--   * conversation_participants.held_at — participant-level hold (NULL =
--     normal). The CHILD's row is held; the sender's row is not, so the
--     sender keeps a normal view (plus a "waiting for approval" chip) while
--     the child's list, unread counts, previews, thread GET and realtime all
--     exclude the conversation via the filters below. Approve clears the
--     stamp; deny severs both rows (quiet removal — Tom's decision).
--
-- Three function changes, one doctrine each:
--   * is_conversation_participant gains "AND held_at IS NULL" — closes
--     browser realtime for held children. GRANTS UNTOUCHED: RLS policies
--     evaluate it as the querying role (040's accepted-by-design note).
--   * get_conversation_list (127 body + held filters). Service-role-only
--     EXECUTE, re-revoked (recreate re-grants PUBLIC — the 124/085/086
--     lesson).
--   * get_unread_message_count (026 body + held filter), tightened to
--     service-role-only — its sole caller is the admin-client route, and the
--     026 'authenticated' grant let any logged-in user count another user's
--     unread by id.
--
-- Existing threads are GRANDFATHERED (Tom's decision): active direct pairs
-- with a supervised child, unblocked both ways, seed the ledger 'approved'.
-- Dormant/severed threads are NOT — revival re-gates.
-- ============================================================================

-- ── 1. approved_contacts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS approved_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  child_profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contact_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('approved', 'denied')),
  source TEXT NOT NULL CHECK (source IN
    ('grandfathered', 'guardian', 'follow', 'child_initiated', 'guardian_decision')),
  decided_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (child_profile_id, contact_profile_id)
);
ALTER TABLE approved_contacts ENABLE ROW LEVEL SECURITY;
-- Zero policies on purpose: service-role only (consent_records precedent).

-- ── 2. Participant hold stamp ────────────────────────────────────────────────
ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_conversation_participants_held
  ON conversation_participants (profile_id) WHERE held_at IS NOT NULL;

COMMENT ON COLUMN conversation_participants.held_at IS
  'First-contact hold (131). Non-null on a supervised child''s row = the conversation is invisible to them until a guardian approves; cleared on approve, row severed (left_at) on deny.';

-- ── 3. RLS helper: a held participant is not a participant ───────────────────
-- CREATE OR REPLACE preserves the existing ACL (anon+authenticated keep
-- EXECUTE — policies evaluate this as the querying role; 040 doctrine).
-- Body style matches the live version: unqualified names + search_path
-- pinned to 'public' (040).
CREATE OR REPLACE FUNCTION is_conversation_participant(conv_id UUID, user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = conv_id
      AND profile_id = user_id
      AND left_at IS NULL
      AND held_at IS NULL
  );
$$;

-- ── 4. get_conversation_list: 127 body + held filters ────────────────────────
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
      AND cp.held_at IS NULL            -- 131: held children see nothing
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
        -- "other" participant of a DM from this). held_at exposed (131) so
        -- the SENDER can render the "waiting for approval" chip.
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
            'held_at', pp.held_at,
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
          'held_at', myp.held_at,
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
     AND myp.held_at IS NULL            -- 131 (mirror of my_convs)
    JOIN public.profiles mypr ON mypr.id = p_user_id
    WHERE (p_before IS NULL OR c.updated_at < p_before)
    ORDER BY c.updated_at DESC
    LIMIT p_limit
  ) sub;
$$;

REVOKE ALL ON FUNCTION public.get_conversation_list(UUID, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversation_list(UUID, integer, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_list(UUID, integer, timestamptz) TO service_role;

-- ── 5. get_unread_message_count: 026 body + held filter, locked down ─────────
DROP FUNCTION IF EXISTS public.get_unread_message_count(UUID);
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
    AND cp.held_at IS NULL              -- 131
    AND m.sender_id <> p_user_id
    AND m.deleted_at IS NULL
    AND m.created_at > GREATEST(
      COALESCE(cp.last_read_at, cp.joined_at, '-infinity'::timestamptz),
      COALESCE(cp.joined_at, '-infinity'::timestamptz)
    );
$$;

REVOKE ALL ON FUNCTION public.get_unread_message_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_unread_message_count(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_message_count(UUID) TO service_role;

-- ── 6. Grandfather backfill (Tom's decision) ─────────────────────────────────
INSERT INTO approved_contacts (child_profile_id, contact_profile_id, status, source)
SELECT DISTINCT child.profile_id, other.profile_id, 'approved', 'grandfathered'
FROM conversation_participants child
JOIN profiles p       ON p.id = child.profile_id AND p.supervision_state = 'supervised'
JOIN conversations c  ON c.id = child.conversation_id AND c.type = 'direct'
JOIN conversation_participants other
  ON other.conversation_id = c.id AND other.profile_id <> child.profile_id
WHERE child.left_at IS NULL AND other.left_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM user_blocks b
    WHERE (b.blocker_id = child.profile_id AND b.blocked_id = other.profile_id)
       OR (b.blocker_id = other.profile_id AND b.blocked_id = child.profile_id))
ON CONFLICT (child_profile_id, contact_profile_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid — every column must read true ─────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_name = 'approved_contacts')                        AS table_ok,
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'conversation_participants'
              AND column_name = 'held_at')                                 AS column_ok,
  EXISTS (SELECT 1 FROM pg_indexes
            WHERE indexname = 'idx_conversation_participants_held')        AS index_ok,
  (SELECT prosrc LIKE '%held_at%' FROM pg_proc
     WHERE proname = 'is_conversation_participant'
       AND pronamespace = 'public'::regnamespace)                          AS helper_ok,
  (SELECT prosrc LIKE '%held_at%' FROM pg_proc
     WHERE proname = 'get_conversation_list' AND pronargs = 3)             AS list_ok,
  (SELECT prosrc LIKE '%held_at%' FROM pg_proc
     WHERE proname = 'get_unread_message_count')                           AS unread_ok,
  (SELECT proacl::text NOT LIKE '%authenticated%' FROM pg_proc
     WHERE proname = 'get_conversation_list' AND pronargs = 3)             AS list_locked,
  (SELECT proacl::text NOT LIKE '%authenticated%' FROM pg_proc
     WHERE proname = 'get_unread_message_count')                           AS unread_locked,
  -- Backfill completeness: no active, unblocked, supervised direct pair
  -- lacks a ledger row.
  NOT EXISTS (
    SELECT 1
    FROM conversation_participants child
    JOIN profiles p       ON p.id = child.profile_id AND p.supervision_state = 'supervised'
    JOIN conversations c  ON c.id = child.conversation_id AND c.type = 'direct'
    JOIN conversation_participants other
      ON other.conversation_id = c.id AND other.profile_id <> child.profile_id
    WHERE child.left_at IS NULL AND other.left_at IS NULL AND child.held_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = child.profile_id AND b.blocked_id = other.profile_id)
           OR (b.blocker_id = other.profile_id AND b.blocked_id = child.profile_id))
      AND NOT EXISTS (SELECT 1 FROM approved_contacts ac
        WHERE ac.child_profile_id = child.profile_id
          AND ac.contact_profile_id = other.profile_id)
  )                                                                        AS backfill_ok;
