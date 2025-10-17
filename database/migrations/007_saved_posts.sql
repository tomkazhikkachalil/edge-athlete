-- Create saved_posts table for users to bookmark posts
CREATE TABLE IF NOT EXISTS saved_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure one save per user per post
  UNIQUE(profile_id, post_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_saved_posts_profile_id ON saved_posts(profile_id);
CREATE INDEX IF NOT EXISTS idx_saved_posts_post_id ON saved_posts(post_id);
CREATE INDEX IF NOT EXISTS idx_saved_posts_created_at ON saved_posts(created_at DESC);

-- Enable Row Level Security
ALTER TABLE saved_posts ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only see their own saved posts
CREATE POLICY "Users can view their own saved posts"
  ON saved_posts FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can save posts"
  ON saved_posts FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can unsave their own posts"
  ON saved_posts FOR DELETE
  USING (auth.uid() = profile_id);

-- Add save_count to posts table
ALTER TABLE posts ADD COLUMN IF NOT EXISTS saves_count INTEGER DEFAULT 0 NOT NULL;

-- Function to increment save count
CREATE OR REPLACE FUNCTION increment_post_save_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts
  SET saves_count = saves_count + 1
  WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to decrement save count
CREATE OR REPLACE FUNCTION decrement_post_save_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE posts
  SET saves_count = GREATEST(0, saves_count - 1)
  WHERE id = OLD.post_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Triggers for save count management
DROP TRIGGER IF EXISTS trigger_increment_post_save_count ON saved_posts;
CREATE TRIGGER trigger_increment_post_save_count
  AFTER INSERT ON saved_posts
  FOR EACH ROW
  EXECUTE FUNCTION increment_post_save_count();

DROP TRIGGER IF EXISTS trigger_decrement_post_save_count ON saved_posts;
CREATE TRIGGER trigger_decrement_post_save_count
  AFTER DELETE ON saved_posts
  FOR EACH ROW
  EXECUTE FUNCTION decrement_post_save_count();

-- Add comment for documentation
COMMENT ON TABLE saved_posts IS 'Stores bookmarked/saved posts for users';
COMMENT ON COLUMN posts.saves_count IS 'Cached count of times this post has been saved';
