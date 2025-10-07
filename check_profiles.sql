-- Check if there are any profiles in the database
SELECT COUNT(*) as total_profiles FROM profiles;

-- Show some sample profiles
SELECT id, full_name, first_name, last_name, sport, school 
FROM profiles 
LIMIT 5;
