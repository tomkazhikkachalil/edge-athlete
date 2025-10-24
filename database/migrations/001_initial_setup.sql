-- Edge Athlete Database Schema
-- Run this in your Supabase SQL Editor

-- Note: JWT secret is automatically managed by Supabase

-- Create profiles table for athlete data
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT,
  last_name TEXT,
  nickname TEXT,
  phone TEXT,
  birthday DATE,
  gender TEXT CHECK (gender IN ('male', 'female', 'custom')),
  location TEXT,
  postal_code TEXT,
  user_type TEXT DEFAULT 'athlete' CHECK (user_type IN ('athlete', 'club', 'league', 'fan')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create clubs table
CREATE TABLE IF NOT EXISTS clubs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create athlete_clubs junction table for many-to-many relationship
CREATE TABLE IF NOT EXISTS athlete_clubs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  athlete_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(athlete_id, club_id)
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE athlete_clubs ENABLE ROW LEVEL SECURITY;

-- Create policies for profiles table
CREATE POLICY "Users can view their own profile" 
  ON profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" 
  ON profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" 
  ON profiles FOR UPDATE 
  USING (auth.uid() = id);

-- Create policies for clubs (public read, authenticated users can view)
CREATE POLICY "Clubs are viewable by authenticated users" 
  ON clubs FOR SELECT 
  TO authenticated 
  USING (true);

-- Create policies for athlete_clubs
CREATE POLICY "Users can view their own club associations" 
  ON athlete_clubs FOR SELECT 
  USING (auth.uid() = athlete_id);

CREATE POLICY "Users can manage their own club associations" 
  ON athlete_clubs FOR ALL 
  USING (auth.uid() = athlete_id);

-- Create function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, user_type)
  VALUES (new.id, new.email, 'athlete');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to call function on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers for updated_at
CREATE TRIGGER handle_updated_at_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

CREATE TRIGGER handle_updated_at_clubs
  BEFORE UPDATE ON clubs
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Insert some sample clubs
INSERT INTO clubs (name, description, location) VALUES 
('Elite Athletics Club', 'Premier training facility for professional athletes', 'New York, NY'),
('Community Sports Center', 'Local sports club for all skill levels', 'Los Angeles, CA'),
('Peak Performance Academy', 'High-performance training for competitive athletes', 'Chicago, IL'),
('Metro Fitness Club', 'Full-service fitness and athletic club', 'Houston, TX')
ON CONFLICT DO NOTHING;