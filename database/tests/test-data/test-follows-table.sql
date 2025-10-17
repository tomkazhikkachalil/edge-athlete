-- Check if follows table exists and has correct structure
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'follows'
ORDER BY ordinal_position;

-- Check if there are any rows
SELECT COUNT(*) as total_follows FROM follows;

-- Check RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'follows';

-- Check RLS policies
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'follows';
