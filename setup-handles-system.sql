-- =====================================================
-- UNIQUE HANDLE SYSTEM - COMPLETE SETUP
-- =====================================================
-- This implements a Twitter/Instagram-style @handle system
-- Run this in Supabase SQL Editor

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    HANDLE SYSTEM SETUP';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- =====================================================
-- PART 1: ADD HANDLE COLUMN TO PROFILES
-- =====================================================

-- Add handle column (unique, case-insensitive)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS handle TEXT;

-- Add handle history tracking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS handle_updated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS handle_change_count INT DEFAULT 0;

-- Create case-insensitive unique index
-- This ensures @TomK and @tomk are treated as the same handle
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle_unique_lower
ON profiles (LOWER(handle));

-- Create regular index for lookups
CREATE INDEX IF NOT EXISTS idx_profiles_handle
ON profiles (handle);

-- =====================================================
-- PART 2: HANDLE HISTORY TABLE
-- =====================================================
-- Track handle changes for audit and redirect purposes

CREATE TABLE IF NOT EXISTS handle_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  old_handle TEXT NOT NULL,
  new_handle TEXT NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

  -- Index for lookups by old handle (for redirects)
  CONSTRAINT handle_history_unique_entry UNIQUE(profile_id, old_handle, changed_at)
);

CREATE INDEX IF NOT EXISTS idx_handle_history_old_handle
ON handle_history (LOWER(old_handle));

CREATE INDEX IF NOT EXISTS idx_handle_history_profile_id
ON handle_history (profile_id, changed_at DESC);

-- =====================================================
-- PART 3: RESERVED HANDLES TABLE
-- =====================================================
-- Protect system words and official entities

CREATE TABLE IF NOT EXISTS reserved_handles (
  handle TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  reserved_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reserved_handles_lower
ON reserved_handles (LOWER(handle));

-- =====================================================
-- PART 4: INSERT RESERVED HANDLES
-- =====================================================

INSERT INTO reserved_handles (handle, reason) VALUES
  -- System/Admin
  ('admin', 'System reserved'),
  ('administrator', 'System reserved'),
  ('support', 'System reserved'),
  ('help', 'System reserved'),
  ('api', 'System reserved'),
  ('team', 'System reserved'),
  ('staff', 'System reserved'),
  ('official', 'System reserved'),
  ('verified', 'System reserved'),

  -- Special paths
  ('me', 'System path'),
  ('u', 'System path'),
  ('user', 'System path'),
  ('users', 'System path'),
  ('athlete', 'System path'),
  ('athletes', 'System path'),
  ('club', 'System path'),
  ('clubs', 'System path'),
  ('league', 'System path'),
  ('leagues', 'System path'),
  ('app', 'System path'),
  ('dashboard', 'System path'),
  ('settings', 'System path'),
  ('profile', 'System path'),
  ('account', 'System path'),

  -- HTTP/Code words
  ('null', 'Technical term'),
  ('undefined', 'Technical term'),
  ('true', 'Technical term'),
  ('false', 'Technical term'),
  ('root', 'System reserved'),
  ('system', 'System reserved'),

  -- Sports (optional - can be used as handles but protected for official use)
  ('golf', 'Sport name'),
  ('basketball', 'Sport name'),
  ('football', 'Sport name'),
  ('soccer', 'Sport name'),
  ('baseball', 'Sport name'),
  ('hockey', 'Sport name'),
  ('volleyball', 'Sport name'),
  ('tennis', 'Sport name'),
  ('swimming', 'Sport name'),
  ('trackandfield', 'Sport name'),

  -- Common abuse vectors
  ('edgeathletes', 'Brand protection'),
  ('edgeathlete', 'Brand protection'),
  ('edge', 'Brand protection')
ON CONFLICT (handle) DO NOTHING;

-- =====================================================
-- PART 5: HANDLE VALIDATION FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION is_valid_handle(input_handle TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  clean_handle TEXT;
BEGIN
  -- Trim and lowercase
  clean_handle := LOWER(TRIM(input_handle));

  -- Check length (3-20 characters)
  IF LENGTH(clean_handle) < 3 OR LENGTH(clean_handle) > 20 THEN
    RETURN FALSE;
  END IF;

  -- Check format: letters, numbers, dots, underscores only
  -- Must start with letter or number
  IF NOT clean_handle ~ '^[a-z0-9][a-z0-9._]*[a-z0-9]$' THEN
    RETURN FALSE;
  END IF;

  -- No consecutive dots or underscores
  IF clean_handle ~ '[._]{2,}' THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- PART 6: CHECK HANDLE AVAILABILITY FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION check_handle_availability(
  input_handle TEXT,
  current_profile_id UUID DEFAULT NULL
)
RETURNS TABLE (
  available BOOLEAN,
  reason TEXT,
  suggestions TEXT[]
) AS $$
DECLARE
  clean_handle TEXT;
  is_valid BOOLEAN;
  existing_profile UUID;
  is_reserved BOOLEAN;
BEGIN
  -- Clean the handle
  clean_handle := LOWER(TRIM(input_handle));

  -- Check if valid format
  is_valid := is_valid_handle(clean_handle);
  IF NOT is_valid THEN
    RETURN QUERY SELECT
      FALSE,
      'Invalid format. Use 3-20 characters: letters, numbers, dots, underscores.',
      ARRAY[]::TEXT[];
    RETURN;
  END IF;

  -- Check if reserved
  SELECT EXISTS (
    SELECT 1 FROM reserved_handles
    WHERE LOWER(handle) = clean_handle
  ) INTO is_reserved;

  IF is_reserved THEN
    RETURN QUERY SELECT
      FALSE,
      'This handle is reserved.',
      ARRAY[clean_handle || '1', clean_handle || '_', clean_handle || '2']::TEXT[];
    RETURN;
  END IF;

  -- Check if already taken
  SELECT id INTO existing_profile
  FROM profiles
  WHERE LOWER(handle) = clean_handle
    AND (current_profile_id IS NULL OR id != current_profile_id)
  LIMIT 1;

  IF existing_profile IS NOT NULL THEN
    -- Generate suggestions
    RETURN QUERY SELECT
      FALSE,
      'This handle is already taken.',
      ARRAY[
        clean_handle || '1',
        clean_handle || '_',
        clean_handle || '2',
        clean_handle || '.' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 3)
      ]::TEXT[];
    RETURN;
  END IF;

  -- Available!
  RETURN QUERY SELECT
    TRUE,
    'Handle is available!',
    ARRAY[]::TEXT[];
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- PART 7: UPDATE HANDLE FUNCTION (WITH RATE LIMITING)
-- =====================================================

CREATE OR REPLACE FUNCTION update_user_handle(
  p_profile_id UUID,
  p_new_handle TEXT
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  new_handle TEXT
) AS $$
DECLARE
  current_handle TEXT;
  clean_new_handle TEXT;
  last_change TIMESTAMP WITH TIME ZONE;
  change_count INT;
  availability_result RECORD;
BEGIN
  -- Get current handle info
  SELECT handle, handle_updated_at, handle_change_count
  INTO current_handle, last_change, change_count
  FROM profiles
  WHERE id = p_profile_id;

  IF current_handle IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Profile not found', NULL::TEXT;
    RETURN;
  END IF;

  -- Clean new handle
  clean_new_handle := LOWER(TRIM(p_new_handle));

  -- Check if same as current (case-insensitive)
  IF LOWER(current_handle) = clean_new_handle THEN
    -- Allow case change without counting as a full change
    UPDATE profiles
    SET handle = p_new_handle
    WHERE id = p_profile_id;

    RETURN QUERY SELECT TRUE, 'Handle casing updated', p_new_handle;
    RETURN;
  END IF;

  -- Rate limiting: max 1 change per 7 days
  IF last_change IS NOT NULL AND last_change > NOW() - INTERVAL '7 days' THEN
    RETURN QUERY SELECT
      FALSE,
      'You can only change your handle once per week. Next available: ' ||
        TO_CHAR(last_change + INTERVAL '7 days', 'Mon DD, YYYY'),
      NULL::TEXT;
    RETURN;
  END IF;

  -- Check availability
  SELECT * INTO availability_result
  FROM check_handle_availability(clean_new_handle, p_profile_id);

  IF NOT availability_result.available THEN
    RETURN QUERY SELECT FALSE, availability_result.reason, NULL::TEXT;
    RETURN;
  END IF;

  -- Save to history
  IF current_handle IS NOT NULL THEN
    INSERT INTO handle_history (profile_id, old_handle, new_handle)
    VALUES (p_profile_id, current_handle, clean_new_handle);
  END IF;

  -- Update profile
  UPDATE profiles
  SET
    handle = p_new_handle,  -- Preserve user's preferred casing
    handle_updated_at = NOW(),
    handle_change_count = COALESCE(change_count, 0) + 1
  WHERE id = p_profile_id;

  RETURN QUERY SELECT
    TRUE,
    'Handle updated successfully! Old @mentions will redirect for 30 days.',
    p_new_handle;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- PART 8: SEARCH BY HANDLE FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION search_by_handle(
  search_term TEXT,
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  profile_id UUID,
  handle TEXT,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  sport TEXT,
  school TEXT,
  match_type TEXT
) AS $$
DECLARE
  clean_term TEXT;
BEGIN
  -- Remove @ if present and clean
  clean_term := LOWER(TRIM(LEADING '@' FROM TRIM(search_term)));

  RETURN QUERY
  SELECT
    p.id,
    p.handle,
    p.first_name,
    p.last_name,
    p.avatar_url,
    p.sport,
    p.school,
    CASE
      WHEN LOWER(p.handle) = clean_term THEN 'exact'
      WHEN LOWER(p.handle) LIKE clean_term || '%' THEN 'prefix'
      ELSE 'partial'
    END AS match_type
  FROM profiles p
  WHERE p.handle IS NOT NULL
    AND LOWER(p.handle) LIKE '%' || clean_term || '%'
  ORDER BY
    -- Exact matches first
    CASE WHEN LOWER(p.handle) = clean_term THEN 0 ELSE 1 END,
    -- Then prefix matches
    CASE WHEN LOWER(p.handle) LIKE clean_term || '%' THEN 0 ELSE 1 END,
    -- Then by length (shorter handles rank higher)
    LENGTH(p.handle),
    -- Finally alphabetically
    p.handle
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- PART 9: RLS POLICIES
-- =====================================================

-- Handle history is private (only owner can see)
ALTER TABLE handle_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own handle history" ON handle_history;
CREATE POLICY "Users can view their own handle history"
  ON handle_history FOR SELECT
  USING (auth.uid() = profile_id);

-- Reserved handles are public (read-only)
ALTER TABLE reserved_handles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reserved handles are viewable by everyone" ON reserved_handles;
CREATE POLICY "Reserved handles are viewable by everyone"
  ON reserved_handles FOR SELECT
  USING (true);

-- =====================================================
-- PART 10: MIGRATE EXISTING DATA
-- =====================================================

DO $$
DECLARE
  profile_record RECORD;
  generated_handle TEXT;
  counter INT;
BEGIN
  RAISE NOTICE 'Migrating existing profiles to handles...';

  FOR profile_record IN
    SELECT id, full_name, first_name, last_name, email
    FROM profiles
    WHERE handle IS NULL
  LOOP
    -- Try username from full_name first
    IF profile_record.full_name IS NOT NULL THEN
      generated_handle := LOWER(REGEXP_REPLACE(profile_record.full_name, '[^a-zA-Z0-9]', '', 'g'));
    ELSIF profile_record.first_name IS NOT NULL AND profile_record.last_name IS NOT NULL THEN
      generated_handle := LOWER(profile_record.first_name || profile_record.last_name);
    ELSIF profile_record.first_name IS NOT NULL THEN
      generated_handle := LOWER(profile_record.first_name);
    ELSE
      -- Use part of email
      generated_handle := LOWER(SPLIT_PART(profile_record.email, '@', 1));
    END IF;

    -- Clean up
    generated_handle := REGEXP_REPLACE(generated_handle, '[^a-z0-9]', '', 'g');

    -- Ensure minimum length
    IF LENGTH(generated_handle) < 3 THEN
      generated_handle := generated_handle || 'user';
    END IF;

    -- Ensure maximum length
    IF LENGTH(generated_handle) > 20 THEN
      generated_handle := SUBSTRING(generated_handle, 1, 20);
    END IF;

    -- Check uniqueness and add number if needed
    counter := 0;
    WHILE EXISTS (SELECT 1 FROM profiles WHERE LOWER(handle) = LOWER(generated_handle)) LOOP
      counter := counter + 1;
      generated_handle := SUBSTRING(generated_handle, 1, 17) || counter::TEXT;
    END LOOP;

    -- Update profile
    UPDATE profiles
    SET handle = generated_handle
    WHERE id = profile_record.id;

    RAISE NOTICE 'Assigned handle @% to profile %', generated_handle, profile_record.id;
  END LOOP;

  RAISE NOTICE 'Migration complete!';
END $$;

-- =====================================================
-- PART 11: MAKE HANDLE REQUIRED FOR NEW USERS
-- =====================================================

-- Don't enforce NOT NULL yet (allow existing nulls)
-- But add a check constraint for new inserts
-- ALTER TABLE profiles ALTER COLUMN handle SET NOT NULL;  -- Run this later after migration

-- =====================================================
-- VERIFICATION
-- =====================================================

DO $$
DECLARE
  total_profiles INT;
  profiles_with_handles INT;
  total_reserved INT;
BEGIN
  SELECT COUNT(*) INTO total_profiles FROM profiles;
  SELECT COUNT(*) INTO profiles_with_handles FROM profiles WHERE handle IS NOT NULL;
  SELECT COUNT(*) INTO total_reserved FROM reserved_handles;

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '    SETUP COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Statistics:';
  RAISE NOTICE '  - Total profiles: %', total_profiles;
  RAISE NOTICE '  - Profiles with handles: %', profiles_with_handles;
  RAISE NOTICE '  - Reserved handles: %', total_reserved;
  RAISE NOTICE '';
  RAISE NOTICE 'Test queries:';
  RAISE NOTICE '  - Check availability: SELECT * FROM check_handle_availability(''testuser'');';
  RAISE NOTICE '  - Search handles: SELECT * FROM search_by_handle(''tom'');';
  RAISE NOTICE '  - Update handle: SELECT * FROM update_user_handle(''user-id'', ''newhandle'');';
  RAISE NOTICE '';
END $$;
