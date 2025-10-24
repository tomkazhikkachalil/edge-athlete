-- Check if the search_profiles function exists
SELECT 
  routine_name,
  routine_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public' 
  AND routine_name = 'search_profiles';

-- If it doesn't exist, let's check what functions DO exist
SELECT routine_name 
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
