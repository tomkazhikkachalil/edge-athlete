

# Unique Handle System - Complete Implementation Guide

## Overview

This guide implements a Twitter/Instagram-style @handle system for user identification across the platform.

---

## 🎯 Features Implemented

✅ **Unique Handles**: Each user gets a unique @handle (e.g., @tomk)
✅ **Case-Insensitive**: @TomK and @tomk are treated as the same
✅ **Reserved Handles**: System words and brand names protected
✅ **Rate Limiting**: Users can change handle once per 7 days
✅ **Handle History**: Tracks changes for audit and redirects
✅ **Validation**: 3-20 characters, letters/numbers/dots/underscores
✅ **Search & Autocomplete**: Fast lookup for @mentions
✅ **Migration**: Automatic handle generation for existing users

---

## 📦 Files Created

### Database:
- `setup-handles-system.sql` - Complete database setup

### Backend:
- `src/lib/handle-validation.ts` - Validation utilities
- `src/app/api/handles/check/route.ts` - Check availability
- `src/app/api/handles/update/route.ts` - Update handle
- `src/app/api/handles/search/route.ts` - Search handles

### Frontend (YOU NEED TO CREATE):
- Handle selection component (onboarding/signup)
- Handle change form (in settings)
- @mention autocomplete component
- Profile routing updates

---

## 🚀 Installation Steps

### Step 1: Run Database Setup

Run this in **Supabase SQL Editor**:

```bash
File: setup-handles-system.sql
```

**What it does:**
- ✅ Adds `handle` column to `profiles` table
- ✅ Creates `handle_history` table for tracking changes
- ✅ Creates `reserved_handles` table with 40+ protected words
- ✅ Adds case-insensitive unique index
- ✅ Creates validation functions
- ✅ Creates search functions
- ✅ Migrates existing users (auto-generates handles)
- ✅ Sets up RLS policies

**Time**: ~30 seconds

---

### Step 2: Update Profile Interface

Add `handle` to your TypeScript Profile interface:

**File**: `src/lib/supabase.ts`

```typescript
export interface Profile {
  id: string;
  email: string;
  // ... existing fields ...
  handle?: string;                    // NEW: User's unique handle
  handle_updated_at?: string;         // NEW: Last handle change
  handle_change_count?: number;       // NEW: Number of changes
}
```

---

### Step 3: Test the API Endpoints

All API routes are ready to use:

#### Check Availability:
```bash
GET /api/handles/check?handle=tomk
GET /api/handles/check?handle=tomk&currentUserId=user-id  # For updates
```

Response:
```json
{
  "available": true,
  "reason": "Handle is available!",
  "suggestions": []
}
```

#### Update Handle:
```bash
POST /api/handles/update
Body: { "handle": "tomk" }
```

Response:
```json
{
  "success": true,
  "message": "Handle updated successfully!",
  "handle": "tomk"
}
```

#### Search Handles:
```bash
GET /api/handles/search?q=tom&limit=10
```

Response:
```json
[
  {
    "id": "uuid",
    "handle": "tomk",
    "firstName": "Tom",
    "lastName": "K",
    "avatarUrl": "...",
    "sport": "golf",
    "school": "...",
    "matchType": "prefix"
  }
]
```

---

## 🎨 UI Components to Create

### 1. Handle Selection Component (Onboarding)

Create: `src/components/HandleSelector.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { validateHandleFormat, checkHandleAvailability, debounce } from '@/lib/handle-validation';

export default function HandleSelector({
  onHandleSelected,
  initialSuggestions
}: {
  onHandleSelected: (handle: string) => void;
  initialSuggestions?: string[];
}) {
  const [handle, setHandle] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>(initialSuggestions || []);

  // Debounced availability check
  useEffect(() => {
    const checkAvailability = debounce(async (value: string) => {
      if (value.length < 3) return;

      // Client-side validation first
      const validation = validateHandleFormat(value);
      if (!validation.isValid) {
        setAvailable(false);
        setError(validation.error || 'Invalid handle');
        setSuggestions(validation.suggestions || []);
        setChecking(false);
        return;
      }

      // Server-side availability check
      setChecking(true);
      const result = await checkHandleAvailability(value);
      setAvailable(result.available);
      setError(result.reason || '');
      setSuggestions(result.suggestions || []);
      setChecking(false);
    }, 500);

    if (handle) {
      setChecking(true);
      checkAvailability(handle);
    } else {
      setAvailable(null);
      setError('');
    }
  }, [handle]);

  const handleSubmit = () => {
    if (available && handle) {
      onHandleSelected(handle);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-4">Choose Your Handle</h2>
      <p className="text-gray-600 mb-6">
        This is your unique identifier on the platform (like @tomk).
        You can change it later, but not too often.
      </p>

      {/* Handle Input */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          Your Handle
        </label>
        <div className="relative">
          <span className="absolute left-3 top-3 text-gray-500">@</span>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value.replace(/^@/, ''))}
            placeholder="yourhandle"
            className="w-full pl-8 pr-10 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            maxLength={20}
          />
          {checking && (
            <div className="absolute right-3 top-3">
              <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
            </div>
          )}
          {!checking && available === true && (
            <div className="absolute right-3 top-3 text-green-600">
              <i className="fas fa-check-circle" />
            </div>
          )}
          {!checking && available === false && (
            <div className="absolute right-3 top-3 text-red-600">
              <i className="fas fa-times-circle" />
            </div>
          )}
        </div>

        {/* Feedback */}
        {!checking && error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
        {!checking && available && (
          <p className="mt-2 text-sm text-green-600">✓ Available!</p>
        )}

        {/* Character count */}
        <p className="mt-1 text-xs text-gray-500">
          {handle.length}/20 characters
        </p>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">
            Suggestions:
          </label>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => setHandle(suggestion)}
                className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-full"
              >
                @{suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!available || checking}
        className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue with @{handle || 'yourhandle'}
      </button>

      {/* Rules */}
      <div className="mt-6 text-xs text-gray-500">
        <p className="font-medium mb-1">Handle rules:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>3-20 characters</li>
          <li>Letters, numbers, dots, underscores only</li>
          <li>Must start and end with letter or number</li>
          <li>Case-insensitive (@TomK = @tomk)</li>
        </ul>
      </div>
    </div>
  );
}
```

---

### 2. @Mention Autocomplete Component

Create: `src/components/MentionInput.tsx`

```typescript
'use client';

import { useState, useRef, useEffect } from 'react';
import { searchHandles } from '@/lib/handle-validation';

export default function MentionInput({
  value,
  onChange,
  placeholder
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Detect @mentions while typing
  useEffect(() => {
    const text = value;
    const cursorPos = textareaRef.current?.selectionStart || 0;

    // Find @ symbol before cursor
    let atIndex = -1;
    for (let i = cursorPos - 1; i >= 0; i--) {
      if (text[i] === '@') {
        atIndex = i;
        break;
      }
      if (text[i] === ' ' || text[i] === '\n') {
        break;
      }
    }

    if (atIndex !== -1) {
      const query = text.substring(atIndex + 1, cursorPos);
      if (query.length > 0 && !query.includes(' ')) {
        setMentionQuery(query);
        setCursorPosition(atIndex);

        // Search for matching handles
        searchHandles(query).then(results => {
          setSuggestions(results);
          setShowSuggestions(results.length > 0);
        });
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  }, [value]);

  const insertMention = (handle: string) => {
    const beforeMention = value.substring(0, cursorPosition);
    const afterCursor = value.substring(textareaRef.current?.selectionStart || 0);
    const newValue = `${beforeMention}@${handle} ${afterCursor}`;

    onChange(newValue);
    setShowSuggestions(false);

    // Set cursor position after mention
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = cursorPosition + handle.length + 2; // @handle + space
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        textareaRef.current.focus();
      }
    }, 0);
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
        rows={4}
      />

      {/* Mention Suggestions Dropdown */}
      {showSuggestions && (
        <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((user) => (
            <button
              key={user.id}
              onClick={() => insertMention(user.handle)}
              className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-3"
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.handle}
                  className="w-8 h-8 rounded-full"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-semibold">
                  {user.handle[0].toUpperCase()}
                </div>
              )}
              <div>
                <div className="font-medium">@{user.handle}</div>
                <div className="text-sm text-gray-500">
                  {user.firstName} {user.lastName}
                  {user.sport && ` • ${user.sport}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

### 3. Update Profile Edit Form

Add handle change to your existing profile edit component:

```typescript
import { updateHandle } from '@/lib/handle-validation';

// In your profile edit component:
const [newHandle, setNewHandle] = useState(profile.handle || '');
const [handleError, setHandleError] = useState('');

const handleUpdateHandle = async () => {
  const result = await updateHandle(newHandle);
  if (result.success) {
    // Success! Update local state
    alert(result.message);
  } else {
    setHandleError(result.message);
  }
};
```

---

## 🔗 Update Profile Routes

### Current: `/athlete/[id]` and `/u/[username]`
### New: Also support `/u/@[handle]`

**File**: `src/app/u/[username]/page.tsx`

Update to handle both username and @handle:

```typescript
export default async function ProfilePage({ params }: { params: { username: string } }) {
  const { username } = params;

  // Check if it's a handle (starts with @) or username
  const isHandle = username.startsWith('@');
  const lookupValue = isHandle ? username.substring(1) : username;

  // Query profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .or(isHandle
      ? `handle.ilike.${lookupValue}`  // Case-insensitive handle match
      : `username.eq.${lookupValue},full_name.eq.${lookupValue}`
    )
    .single();

  // ... rest of your profile page logic
}
```

---

## 📝 Database Functions Reference

### check_handle_availability

```sql
SELECT * FROM check_handle_availability('tomk');
SELECT * FROM check_handle_availability('tomk', 'user-id');  -- For updates
```

Returns:
- `available` (boolean)
- `reason` (text)
- `suggestions` (text[])

### update_user_handle

```sql
SELECT * FROM update_user_handle('user-id', 'newhandle');
```

Returns:
- `success` (boolean)
- `message` (text)
- `new_handle` (text)

### search_by_handle

```sql
SELECT * FROM search_by_handle('tom', 10);
```

Returns profiles matching handle search.

---

## 🔒 Security & Rules

### Validation Rules:
- ✅ 3-20 characters
- ✅ Letters, numbers, dots, underscores only
- ✅ Must start/end with letter or number
- ✅ No consecutive dots/underscores
- ✅ Case-insensitive uniqueness

### Rate Limiting:
- ✅ 1 handle change per 7 days
- ✅ Case changes don't count as full changes
- ✅ Tracked in `handle_change_count`

### Reserved Handles:
- ✅ 40+ system words protected
- ✅ Add more via `INSERT INTO reserved_handles`

---

## 🧪 Testing Checklist

Run these tests after setup:

### Database Tests:

```sql
-- Test validation
SELECT is_valid_handle('tomk');  -- Should be true
SELECT is_valid_handle('to');    -- Should be false (too short)
SELECT is_valid_handle('tom__k'); -- Should be false (consecutive underscores)

-- Test availability
SELECT * FROM check_handle_availability('testuser');

-- Test update
SELECT * FROM update_user_handle('your-user-id', 'newhandle');

-- Test search
SELECT * FROM search_by_handle('tom');
```

### API Tests:

```bash
# Check availability
curl "http://localhost:3000/api/handles/check?handle=tomk"

# Search handles
curl "http://localhost:3000/api/handles/search?q=tom"

# Update handle (requires auth)
curl -X POST "http://localhost:3000/api/handles/update" \
  -H "Content-Type: application/json" \
  -d '{"handle":"newhandle"}'
```

### UI Tests:

1. ✅ Sign up new user → Choose handle
2. ✅ Type invalid handle → See error
3. ✅ Type taken handle → See suggestions
4. ✅ Type available handle → See checkmark
5. ✅ Submit handle → Saves correctly
6. ✅ Try changing handle → Works once per week
7. ✅ Type @mention in post → See autocomplete
8. ✅ Select mention → Inserts @handle
9. ✅ Visit /u/@handle → Shows profile

---

## 🚨 Troubleshooting

### "Handle already taken" but user deleted
- Old handle is in `handle_history`
- It becomes available immediately after user changes it
- Check: `SELECT * FROM handle_history WHERE old_handle = 'handle';`

### Case sensitivity issues
- Database uses `LOWER(handle)` for uniqueness
- Display preserves user's preferred casing
- Check index: `idx_profiles_handle_unique_lower`

### Rate limit not working
- Check `handle_updated_at` column
- Function checks: `last_change > NOW() - INTERVAL '7 days'`
- Reset manually: `UPDATE profiles SET handle_updated_at = NULL WHERE id = 'user-id';`

### Mentions not autocompleting
- Check `search_by_handle` function exists
- Test: `SELECT * FROM search_by_handle('test');`
- Verify API route: `/api/handles/search`

---

## 📊 Analytics & Monitoring

### Useful Queries:

```sql
-- Most popular handle patterns
SELECT SUBSTRING(handle, 1, 3) as prefix, COUNT(*)
FROM profiles
WHERE handle IS NOT NULL
GROUP BY prefix
ORDER BY COUNT(*) DESC
LIMIT 10;

-- Recent handle changes
SELECT p.handle, h.old_handle, h.new_handle, h.changed_at
FROM handle_history h
JOIN profiles p ON p.id = h.profile_id
ORDER BY h.changed_at DESC
LIMIT 20;

-- Users without handles (should be 0 after migration)
SELECT COUNT(*) FROM profiles WHERE handle IS NULL;

-- Reserved handle attempts (requires logging)
SELECT handle, COUNT(*) as attempts
FROM reserved_handles
GROUP BY handle
ORDER BY attempts DESC;
```

---

## 🎉 Success Criteria

After implementation, you should have:

- ✅ Every user has a unique @handle
- ✅ Handles are searchable and used for mentions
- ✅ Profile URLs work with handles: `/u/@handle`
- ✅ Users can change handles (with rate limit)
- ✅ Autocomplete works when typing @
- ✅ Reserved words are protected
- ✅ Case-insensitive uniqueness enforced
- ✅ Handle history tracked for auditing

---

## 🔄 Migration Summary

The SQL script automatically:
1. ✅ Adds handle columns to profiles
2. ✅ Generates handles for existing users based on:
   - `full_name` (preferred)
   - `first_name` + `last_name`
   - Email username
3. ✅ Ensures uniqueness with numeric suffixes
4. ✅ Creates all necessary indexes and functions

**No manual migration needed!** Just run the SQL script.

---

## 📚 Next Steps

1. **Run** `setup-handles-system.sql` in Supabase
2. **Update** Profile TypeScript interface
3. **Create** HandleSelector component
4. **Create** MentionInput component
5. **Add** handle to signup flow
6. **Add** handle change to settings
7. **Update** profile routing
8. **Test** thoroughly

---

## 💡 Future Enhancements

- **Handle verification**: Blue checkmark for official accounts
- **Handle marketplace**: Allow buying/selling handles
- **Handle analytics**: Track @mention frequency
- **Handle redirects**: Longer redirect period (currently 30 days)
- **Handle vanity URLs**: Custom domains pointing to handles
- **Handle emoji**: Support sport emojis (⛳, 🏀, etc.)

---

Your unique handle system is now ready to deploy! 🚀
