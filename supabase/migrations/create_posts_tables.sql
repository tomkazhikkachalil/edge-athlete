-- Create posts table
CREATE TABLE IF NOT EXISTS public.posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sport_key TEXT,
  caption TEXT,
  visibility TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'followers')),
  stats_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  likes_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0
);

-- Create post_media table
CREATE TABLE IF NOT EXISTS public.post_media (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  thumbnail_url TEXT,
  display_order INTEGER DEFAULT 0,
  width INTEGER,
  height INTEGER,
  duration INTEGER, -- for videos, in seconds
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create post_likes table for tracking likes
CREATE TABLE IF NOT EXISTS public.post_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(post_id, profile_id)
);

-- Create post_comments table
CREATE TABLE IF NOT EXISTS public.post_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES public.post_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_posts_profile_id ON public.posts(profile_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_sport_key ON public.posts(sport_key);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON public.post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON public.post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_profile_id ON public.post_likes(profile_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON public.post_comments(post_id);

-- Enable Row Level Security
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for posts
-- Allow users to read public posts
CREATE POLICY "Public posts are viewable by everyone" 
  ON public.posts FOR SELECT 
  USING (visibility = 'public');

-- Allow users to read their own posts regardless of visibility
CREATE POLICY "Users can view their own posts" 
  ON public.posts FOR SELECT 
  USING (auth.uid() = profile_id);

-- Allow users to create their own posts
CREATE POLICY "Users can create their own posts" 
  ON public.posts FOR INSERT 
  WITH CHECK (auth.uid() = profile_id);

-- Allow users to update their own posts
CREATE POLICY "Users can update their own posts" 
  ON public.posts FOR UPDATE 
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

-- Allow users to delete their own posts
CREATE POLICY "Users can delete their own posts" 
  ON public.posts FOR DELETE 
  USING (auth.uid() = profile_id);

-- RLS Policies for post_media
-- Allow reading media for posts user can see
CREATE POLICY "Users can view media for accessible posts" 
  ON public.post_media FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.posts 
      WHERE posts.id = post_media.post_id 
      AND (posts.visibility = 'public' OR posts.profile_id = auth.uid())
    )
  );

-- Allow users to add media to their own posts
CREATE POLICY "Users can add media to their own posts" 
  ON public.post_media FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.posts 
      WHERE posts.id = post_media.post_id 
      AND posts.profile_id = auth.uid()
    )
  );

-- Allow users to update media on their own posts
CREATE POLICY "Users can update media on their own posts" 
  ON public.post_media FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.posts 
      WHERE posts.id = post_media.post_id 
      AND posts.profile_id = auth.uid()
    )
  );

-- Allow users to delete media from their own posts
CREATE POLICY "Users can delete media from their own posts" 
  ON public.post_media FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM public.posts 
      WHERE posts.id = post_media.post_id 
      AND posts.profile_id = auth.uid()
    )
  );

-- RLS Policies for post_likes
-- Allow users to view all likes
CREATE POLICY "Anyone can view post likes" 
  ON public.post_likes FOR SELECT 
  USING (true);

-- Allow users to like posts they can see
CREATE POLICY "Users can like accessible posts" 
  ON public.post_likes FOR INSERT 
  WITH CHECK (
    auth.uid() = profile_id AND
    EXISTS (
      SELECT 1 FROM public.posts 
      WHERE posts.id = post_likes.post_id 
      AND (posts.visibility = 'public' OR posts.profile_id = auth.uid())
    )
  );

-- Allow users to remove their own likes
CREATE POLICY "Users can remove their own likes" 
  ON public.post_likes FOR DELETE 
  USING (auth.uid() = profile_id);

-- RLS Policies for post_comments
-- Allow viewing comments on accessible posts
CREATE POLICY "Users can view comments on accessible posts" 
  ON public.post_comments FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.posts 
      WHERE posts.id = post_comments.post_id 
      AND (posts.visibility = 'public' OR posts.profile_id = auth.uid())
    )
  );

-- Allow users to comment on accessible posts
CREATE POLICY "Users can comment on accessible posts" 
  ON public.post_comments FOR INSERT 
  WITH CHECK (
    auth.uid() = profile_id AND
    EXISTS (
      SELECT 1 FROM public.posts 
      WHERE posts.id = post_comments.post_id 
      AND (posts.visibility = 'public' OR posts.profile_id = auth.uid())
    )
  );

-- Allow users to update their own comments
CREATE POLICY "Users can update their own comments" 
  ON public.post_comments FOR UPDATE 
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

-- Allow users to delete their own comments
CREATE POLICY "Users can delete their own comments" 
  ON public.post_comments FOR DELETE 
  USING (auth.uid() = profile_id);

-- Create function to update posts.updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for posts.updated_at
CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON public.posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for post_comments.updated_at
CREATE TRIGGER update_post_comments_updated_at BEFORE UPDATE ON public.post_comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to update likes_count
CREATE OR REPLACE FUNCTION update_post_likes_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.posts 
        SET likes_count = likes_count + 1 
        WHERE id = NEW.post_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.posts 
        SET likes_count = GREATEST(0, likes_count - 1) 
        WHERE id = OLD.post_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for likes count
CREATE TRIGGER update_post_likes_count_trigger
AFTER INSERT OR DELETE ON public.post_likes
    FOR EACH ROW EXECUTE FUNCTION update_post_likes_count();

-- Create function to update comments_count
CREATE OR REPLACE FUNCTION update_post_comments_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.posts 
        SET comments_count = comments_count + 1 
        WHERE id = NEW.post_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.posts 
        SET comments_count = GREATEST(0, comments_count - 1) 
        WHERE id = OLD.post_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for comments count
CREATE TRIGGER update_post_comments_count_trigger
AFTER INSERT OR DELETE ON public.post_comments
    FOR EACH ROW EXECUTE FUNCTION update_post_comments_count();