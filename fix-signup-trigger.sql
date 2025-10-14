-- ============================================
-- FIX SIGNUP TRIGGER
-- This script ensures the profile creation trigger works correctly
-- ============================================

-- Drop existing trigger and function to recreate cleanly
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- Create improved function that handles profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_exists BOOLEAN;
BEGIN
  -- Check if profile already exists
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = new.id
  ) INTO profile_exists;

  -- Only insert if profile doesn't exist
  IF NOT profile_exists THEN
    INSERT INTO public.profiles (
      id,
      email,
      user_type,
      created_at,
      updated_at
    )
    VALUES (
      new.id,
      new.email,
      'athlete',
      now(),
      now()
    );

    RAISE NOTICE 'Profile created for user: %', new.id;
  ELSE
    RAISE NOTICE 'Profile already exists for user: %', new.id;
  END IF;

  RETURN new;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error but don't fail the auth signup
    RAISE WARNING 'Error creating profile for user %: %', new.id, SQLERRM;
    -- Still return new so auth signup succeeds
    RETURN new;
END;
$$;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- Verify the trigger exists
SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement,
  action_timing
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Test query: Check if profiles table is accessible
SELECT
  table_name,
  column_name,
  is_nullable,
  column_default,
  data_type
FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name IN ('id', 'email', 'user_type', 'created_at', 'updated_at')
ORDER BY ordinal_position;

RAISE NOTICE 'Signup trigger fixed successfully!';
