-- Show what you can search for
SELECT
  CONCAT(first_name, ' ', last_name) as "Full Name to Search",
  email as "Email to Search",
  full_name as "Username to Search",
  sport as "Sport",
  school as "School",
  visibility as "Visibility",
  CASE
    WHEN visibility = 'public' AND first_name IS NOT NULL AND last_name IS NOT NULL
    THEN '✓ Will appear in search'
    WHEN visibility = 'private' AND first_name IS NOT NULL AND last_name IS NOT NULL
    THEN '✗ Private (won''t show in search)'
    ELSE '✗ Missing name data'
  END as "Search Status"
FROM profiles
ORDER BY visibility DESC, first_name ASC;
