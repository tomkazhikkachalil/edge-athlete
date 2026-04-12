-- =====================================================
-- Message Reactions: emoji + GIF reaction support
-- =====================================================
-- 1. Add parent_message_id to messages for GIF reactions
--    (GIF reactions are stored as messages with type 'gif_reaction'
--     linked to their parent via this column)
-- 2. Expand messages type CHECK to include 'gif_reaction'
-- 3. Add indexes for efficient reaction lookups
-- =====================================================

-- 1. Add parent_message_id column for GIF reactions
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES messages(id) ON DELETE CASCADE;

-- 2. Expand messages type CHECK to include gif_reaction
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages
  ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'image', 'video', 'shared_post', 'shared_profile', 'gif_reaction'));

-- 3. Index for fetching GIF reactions by parent message
CREATE INDEX IF NOT EXISTS idx_messages_parent
  ON messages(parent_message_id)
  WHERE parent_message_id IS NOT NULL;

-- 4. Index for fetching emoji reactions by message (missing from 012_messaging.sql)
CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON message_reactions(message_id);
