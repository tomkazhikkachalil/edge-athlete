# Name Field Fix - Complete Summary

## Problem Identified ✅

You correctly identified that profiles had `full_name` populated but `first_name` and `last_name` were returning `NULL`. This was breaking search functionality and profile display logic.

### Root Cause

The profile editing forms were only saving the `full_name` field without splitting it into `first_name` and `last_name` components.

**Original behavior:**
```typescript
// ❌ Old code - only saved full_name
updateData = {
  full_name: basicForm.full_name.trim(),
  username: basicForm.username.trim(),
  bio: basicForm.bio.trim(),
};
```

**Result:**
- ✅ `full_name`: "John Doe"
- ❌ `first_name`: NULL
- ❌ `last_name`: NULL

## Solutions Implemented

### 1. Fixed EditProfileTabs Component ✅
**File**: `src/components/EditProfileTabs.tsx`

Now splits `full_name` into `first_name` and `last_name` when saving:

```typescript
// ✅ New code - splits name into components
const fullNameTrimmed = basicForm.full_name.trim();
let firstName = '';
let lastName = '';

if (fullNameTrimmed) {
  const nameParts = fullNameTrimmed.split(' ').filter(part => part.length > 0);
  if (nameParts.length === 1) {
    firstName = nameParts[0];  // Single name
  } else if (nameParts.length >= 2) {
    firstName = nameParts[0];  // First word
    lastName = nameParts.slice(1).join(' ');  // Rest of the name
  }
}

updateData = {
  full_name: fullNameTrimmed || undefined,
  first_name: firstName || undefined,
  last_name: lastName || undefined,
  username: basicForm.username.trim() || undefined,
  bio: basicForm.bio.trim() || undefined,
};
```

### 2. Fixed Inline Editing on Profile Page ✅
**File**: `src/app/athlete/page.tsx`

The inline name editing now also splits names:

```typescript
else if (field === 'full_name') {
  // Split full_name into first_name and last_name
  const fullNameTrimmed = (newValue as string).trim();
  // ... splitting logic ...

  // Save all three name fields
  const response = await fetch('/api/profile', {
    method: 'PUT',
    body: JSON.stringify({
      profileData: {
        full_name: fullNameTrimmed || null,
        first_name: firstName || null,
        last_name: lastName || null
      },
      userId: user.id
    }),
  });
}
```

### 3. Database Migration for Existing Profiles ✅
**File**: `fix-name-fields.sql`

This SQL script:
- **Updates existing profiles** to split their `full_name` into components
- **Creates a database trigger** to automatically split names on future inserts/updates
- **Provides verification queries** to check the results

## How Names Are Split

### Examples:

| Input (full_name) | first_name | last_name |
|-------------------|------------|-----------|
| "John" | "John" | NULL |
| "John Doe" | "John" | "Doe" |
| "John Michael Doe" | "John" | "Michael Doe" |
| "María García López" | "María" | "García López" |

**Logic:**
1. Single word → `first_name` only
2. Two words → First word = `first_name`, Second word = `last_name`
3. Three+ words → First word = `first_name`, Remaining words = `last_name`

## How to Apply the Fixes

### Step 1: Code Changes (Already Applied) ✅
The code fixes have been applied to:
- `src/components/EditProfileTabs.tsx`
- `src/app/athlete/page.tsx`

**No action needed** - these are already in your codebase.

### Step 2: Fix Existing Database Records (Required)
Run the database migration in Supabase:

```bash
# Open Supabase Dashboard → SQL Editor
# Copy and run the contents of: fix-name-fields.sql
```

This will:
1. Update all existing profiles with `full_name` but missing name components
2. Create a database trigger for future profiles
3. Show verification results

### Step 3: Test the Fix
1. Edit your profile name in the Edit Profile modal
2. Change it to something like "Jane Smith"
3. Save and verify in database:

```sql
SELECT full_name, first_name, last_name, email
FROM profiles
WHERE email = 'your-email@example.com';
```

Expected result:
```
full_name: "Jane Smith"
first_name: "Jane"
last_name: "Smith"
```

## What This Fixes

### ✅ Search Functionality
```sql
-- Now ALL of these work:
SELECT * FROM profiles WHERE full_name ILIKE '%Jane%';
SELECT * FROM profiles WHERE first_name ILIKE '%Jane%';
SELECT * FROM profiles WHERE last_name ILIKE '%Smith%';
```

### ✅ Display Logic
Components that use `formatDisplayName()` now have proper data:
```typescript
formatDisplayName(profile.full_name, profile.first_name, profile.last_name)
// Works with any combination of name fields
```

### ✅ Future Profiles
The database trigger ensures all future profile updates automatically split names:
```sql
-- Insert a new profile
INSERT INTO profiles (email, full_name)
VALUES ('new@user.com', 'Alice Johnson');

-- Automatically splits into:
-- full_name: "Alice Johnson"
-- first_name: "Alice"
-- last_name: "Johnson"
```

## Database Trigger Details

The migration creates a PostgreSQL trigger that runs before every INSERT or UPDATE:

```sql
CREATE TRIGGER auto_split_full_name
  BEFORE INSERT OR UPDATE OF full_name
  ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION split_full_name();
```

**Benefits:**
- ✅ Automatic - no code changes needed
- ✅ Consistent - works for all profile updates
- ✅ Database-level - can't be bypassed
- ✅ Efficient - only runs when full_name changes

## Verification Checklist

After applying all fixes:

- [ ] Run `fix-name-fields.sql` in Supabase SQL Editor
- [ ] Verify existing profiles updated:
  ```sql
  SELECT full_name, first_name, last_name
  FROM profiles
  WHERE first_name IS NOT NULL;
  ```
- [ ] Edit a profile name in the UI
- [ ] Check database shows all three name fields populated
- [ ] Search by first name works
- [ ] Search by last name works
- [ ] Profile display shows correct names

## Files Modified/Created

1. ✅ **src/components/EditProfileTabs.tsx** - Added name splitting to Edit Profile modal
2. ✅ **src/app/athlete/page.tsx** - Added name splitting to inline editing
3. ✅ **fix-name-fields.sql** - Database migration + trigger creation
4. ✅ **NAME_FIELD_FIX_SUMMARY.md** - This documentation

## Edge Cases Handled

### Multiple Middle Names
```
"John Michael Patrick Doe" →
  first_name: "John"
  last_name: "Michael Patrick Doe"
```

### Hyphenated Names
```
"Mary-Jane Watson-Parker" →
  first_name: "Mary-Jane"
  last_name: "Watson-Parker"
```

### Single Name (Mononym)
```
"Beyoncé" →
  first_name: "Beyoncé"
  last_name: NULL
```

### Extra Spaces
```
"  John   Doe  " →
  first_name: "John"
  last_name: "Doe"
  (Trimmed and normalized)
```

## API Response Format

After the fix, the API returns properly structured profile data:

```json
{
  "profile": {
    "id": "...",
    "email": "john.doe@example.com",
    "full_name": "John Doe",
    "first_name": "John",
    "last_name": "Doe",
    "username": "johndoe",
    "bio": "...",
    ...
  }
}
```

## Search API Now Works Properly

The `/api/search` endpoint can now search all name fields:

```typescript
// Search query matches any name field
.or(`
  full_name.ilike.%${query}%,
  first_name.ilike.%${query}%,
  last_name.ilike.%${query}%,
  username.ilike.%${query}%,
  ...
`)
```

**Examples that now work:**
- Search "John" → Finds profiles with first_name = "John"
- Search "Doe" → Finds profiles with last_name = "Doe"
- Search "John Doe" → Finds profiles with full_name = "John Doe"

## Rollback Instructions

If you need to rollback the database trigger:

```sql
-- Remove the trigger
DROP TRIGGER IF EXISTS auto_split_full_name ON profiles;
DROP FUNCTION IF EXISTS split_full_name();

-- If you created a backup
-- DELETE FROM profiles;
-- INSERT INTO profiles SELECT * FROM profiles_backup;
```

The code changes are non-destructive and don't need rollback - they only add functionality.

## Future Enhancements

Consider these improvements:

1. **Nickname Field**: Add `nickname` or `preferred_name` field
2. **Suffix Field**: Add field for Jr., Sr., III, etc.
3. **Prefix Field**: Add field for Dr., Prof., etc.
4. **Name Validation**: Add validation for special characters, length limits
5. **Name History**: Track name changes for audit purposes

## Testing Script

Use this SQL to test the trigger:

```sql
-- Test 1: Insert new profile
INSERT INTO profiles (id, email, full_name)
VALUES (gen_random_uuid(), 'test1@example.com', 'Alice Johnson');

-- Verify split
SELECT full_name, first_name, last_name
FROM profiles
WHERE email = 'test1@example.com';
-- Expected: Alice | Alice | Johnson

-- Test 2: Update existing profile
UPDATE profiles
SET full_name = 'Bob Smith Wilson'
WHERE email = 'test1@example.com';

-- Verify update
SELECT full_name, first_name, last_name
FROM profiles
WHERE email = 'test1@example.com';
-- Expected: Bob Smith Wilson | Bob | Smith Wilson

-- Cleanup
DELETE FROM profiles WHERE email = 'test1@example.com';
```

## Summary

✅ **Problem**: Profiles had `full_name` but missing `first_name` and `last_name`
✅ **Cause**: Forms only saved `full_name` without splitting
✅ **Solution**: Updated forms + database migration + automatic trigger
✅ **Result**: All name fields now properly populated for search and display

**Action Required**: Run `fix-name-fields.sql` in Supabase SQL Editor to fix existing profiles and enable automatic splitting.
