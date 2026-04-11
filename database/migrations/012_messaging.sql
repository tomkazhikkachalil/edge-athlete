-- ============================================================================
-- MESSAGING SYSTEM — Edge Athlete Communication Layer
-- ============================================================================
-- Supports: direct messages, group chats, rich content sharing (posts/profiles)
-- Realtime: Enable the `messages` table in Supabase Dashboard after running.
-- ============================================================================

-- ── 1. messaging_permission on profiles ─────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS messaging_permission TEXT
    NOT NULL DEFAULT 'everyone'
    CHECK (messaging_permission IN ('everyone', 'fans_only', 'mutual_fans', 'nobody'));

-- ── 2. conversations ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('direct', 'group')),
  name        TEXT,          -- NULL for DMs, required for groups
  avatar_url  TEXT,          -- group avatar only
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ── 3. conversation_participants ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_participants (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  last_read_at     TIMESTAMPTZ,   -- unread count derived from this
  is_muted         BOOLEAN NOT NULL DEFAULT false,
  joined_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  left_at          TIMESTAMPTZ,   -- NULL = active; set = left/removed
  UNIQUE (conversation_id, profile_id)
);

-- ── 4. messages ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type              TEXT NOT NULL DEFAULT 'text'
                    CHECK (type IN ('text', 'image', 'video', 'shared_post', 'shared_profile')),
  content           TEXT,
  media_url         TEXT,
  media_type        TEXT,           -- 'image' | 'video'
  shared_post_id    UUID REFERENCES posts(id) ON DELETE SET NULL,
  shared_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at        TIMESTAMPTZ,    -- soft delete
  created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ── 5. message_reactions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_reactions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (message_id, profile_id, emoji)
);

-- ── 6. user_blocks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_blocks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  blocker_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (blocker_id, blocked_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cp_profile_active
  ON conversation_participants(profile_id)
  WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cp_conversation
  ON conversation_participants(conversation_id);

CREATE INDEX IF NOT EXISTS idx_messages_conv_time
  ON messages(conversation_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON messages(sender_id);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON conversations(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker
  ON user_blocks(blocker_id);

CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
  ON user_blocks(blocked_id);

-- ── Trigger: bump conversations.updated_at on new message ───────────────────
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE conversations SET updated_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_conv_on_msg ON messages;
CREATE TRIGGER trg_update_conv_on_msg
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_conversation_on_message();

-- ── Triggers: updated_at on conversations and messages ──────────────────────
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE conversations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks           ENABLE ROW LEVEL SECURITY;

-- Helper function: check if user is an active participant
-- SECURITY DEFINER so it can query conversation_participants freely
CREATE OR REPLACE FUNCTION is_conversation_participant(conv_id UUID, user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = conv_id
      AND profile_id = user_id
      AND left_at IS NULL
  );
$$;

-- conversations
DROP POLICY IF EXISTS "Participants can view conversations" ON conversations;
CREATE POLICY "Participants can view conversations"
  ON conversations FOR SELECT
  USING (is_conversation_participant(id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Participants can update group settings" ON conversations;
CREATE POLICY "Participants can update group settings"
  ON conversations FOR UPDATE
  USING (is_conversation_participant(id, (SELECT auth.uid())));

-- conversation_participants
DROP POLICY IF EXISTS "Participants can view participant list" ON conversation_participants;
CREATE POLICY "Participants can view participant list"
  ON conversation_participants FOR SELECT
  USING (is_conversation_participant(conversation_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can update own participant row" ON conversation_participants;
CREATE POLICY "Users can update own participant row"
  ON conversation_participants FOR UPDATE
  USING (profile_id = (SELECT auth.uid()));

-- messages: SELECT only non-deleted, by active participants
DROP POLICY IF EXISTS "Participants can view messages" ON messages;
CREATE POLICY "Participants can view messages"
  ON messages FOR SELECT
  USING (
    deleted_at IS NULL
    AND is_conversation_participant(conversation_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Participants can insert messages" ON messages;
CREATE POLICY "Participants can insert messages"
  ON messages FOR INSERT
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND is_conversation_participant(conversation_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Sender can soft-delete own message" ON messages;
CREATE POLICY "Sender can soft-delete own message"
  ON messages FOR UPDATE
  USING (sender_id = (SELECT auth.uid()));

-- message_reactions
DROP POLICY IF EXISTS "Participants can view reactions" ON message_reactions;
CREATE POLICY "Participants can view reactions"
  ON message_reactions FOR SELECT
  USING (
    is_conversation_participant(
      (SELECT conversation_id FROM messages WHERE id = message_id),
      (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Participants can add reactions" ON message_reactions;
CREATE POLICY "Participants can add reactions"
  ON message_reactions FOR INSERT
  WITH CHECK (
    profile_id = (SELECT auth.uid())
    AND is_conversation_participant(
      (SELECT conversation_id FROM messages WHERE id = message_id),
      (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can remove own reactions" ON message_reactions;
CREATE POLICY "Users can remove own reactions"
  ON message_reactions FOR DELETE
  USING (profile_id = (SELECT auth.uid()));

-- user_blocks
DROP POLICY IF EXISTS "Users see own blocks" ON user_blocks;
CREATE POLICY "Users see own blocks"
  ON user_blocks FOR SELECT
  USING (blocker_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users manage own blocks" ON user_blocks;
CREATE POLICY "Users manage own blocks"
  ON user_blocks FOR ALL
  USING (blocker_id = (SELECT auth.uid()));

-- ── Extend notifications type CHECK ──────────────────────────────────────────
-- Adds 'new_message' to the allowed notification types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'follow_request',
    'follow_accepted',
    'new_follower',
    'like',
    'comment',
    'comment_reply',
    'mention',
    'tag',
    'achievement',
    'system_announcement',
    'club_update',
    'team_update',
    'new_message'
  ));

-- ============================================================================
-- AFTER RUNNING: Enable Realtime for the `messages` table in Supabase Dashboard
-- Tables → messages → Enable Realtime
-- ============================================================================
