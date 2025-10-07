# Handle System - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Run Database Setup (1 minute)

```bash
# In Supabase SQL Editor, paste and run:
setup-handles-system.sql
```

**What it does:**
- ✅ Adds handle system to database
- ✅ Auto-generates handles for existing users
- ✅ Protects 40+ reserved words
- ✅ Creates validation & search functions

---

### Step 2: Test API Endpoints (2 minutes)

```bash
# Check if a handle is available
curl "http://localhost:3000/api/handles/check?handle=tomk"

# Search for handles (for @mentions)
curl "http://localhost:3000/api/handles/search?q=tom"

# Update user's handle (requires authentication)
curl -X POST "http://localhost:3000/api/handles/update" \
  -H "Content-Type: application/json" \
  -d '{"handle":"newhandle"}'
```

---

### Step 3: Update TypeScript Interface (30 seconds)

**File**: `src/lib/supabase.ts`

```typescript
export interface Profile {
  // ... existing fields ...
  handle?: string;
  handle_updated_at?: string;
  handle_change_count?: number;
}
```

---

### Step 4: Verify Migration (30 seconds)

```sql
-- In Supabase SQL Editor:
SELECT id, handle, first_name, last_name
FROM profiles
ORDER BY created_at DESC
LIMIT 10;

-- All users should have handles assigned!
```

---

## ✅ What's Included

### Database Functions:
```sql
-- Check if handle is available
SELECT * FROM check_handle_availability('tomk');

-- Search handles (for autocomplete)
SELECT * FROM search_by_handle('tom');

-- Update handle with rate limiting
SELECT * FROM update_user_handle('user-id', 'newhandle');

-- Validate handle format
SELECT is_valid_handle('tomk');  -- Returns true/false
```

### API Endpoints:
- `GET /api/handles/check?handle=tomk` - Check availability
- `GET /api/handles/search?q=tom` - Search handles
- `POST /api/handles/update` - Update user's handle

### Client Libraries:
- `src/lib/handle-validation.ts` - All validation utilities

---

## 🎨 UI Components to Build

### 1. Handle Selector (Onboarding)

```typescript
import HandleSelector from '@/components/HandleSelector';

<HandleSelector
  onHandleSelected={(handle) => console.log('Selected:', handle)}
  initialSuggestions={['tomk', 'tomk1', 'tom_k']}
/>
```

### 2. @Mention Autocomplete

```typescript
import MentionInput from '@/components/MentionInput';

<MentionInput
  value={text}
  onChange={setText}
  placeholder="Write a post... (use @ to mention)"
/>
```

### 3. Handle Change Form (Settings)

```typescript
import { updateHandle } from '@/lib/handle-validation';

const handleChange = async () => {
  const result = await updateHandle(newHandle);
  alert(result.message);
};
```

---

## 📋 Handle Rules

### Format:
- ✅ 3-20 characters
- ✅ Letters, numbers, dots, underscores
- ✅ Must start/end with letter or number
- ✅ No consecutive dots/underscores

### Examples:
- ✅ `tomk` - Good
- ✅ `tom.k` - Good
- ✅ `tom_k` - Good
- ✅ `tomk123` - Good
- ❌ `to` - Too short
- ❌ `tom..k` - Consecutive dots
- ❌ `_tomk` - Starts with underscore
- ❌ `admin` - Reserved word

### Rate Limiting:
- 🔄 1 change per 7 days
- ✅ Case changes don't count (@TomK → @tomk is free)

---

## 🔍 How to Use Handles

### In Profile URLs:
```
https://yourapp.com/u/@tomk
https://yourapp.com/u/tomk  (@ optional)
```

### In @Mentions:
```
"Great game @tomk! 🏌️"
"Nice shot @sarah_golf!"
```

### In Search:
```
Search: "@tom" → Shows all handles starting with "tom"
Search: "tom" → Shows profiles and handles matching "tom"
```

---

## 🧪 Quick Tests

### Test 1: Check Availability

```javascript
import { checkHandleAvailability } from '@/lib/handle-validation';

const result = await checkHandleAvailability('tomk');
console.log(result);
// { available: true, reason: "Handle is available!" }
```

### Test 2: Validate Format

```javascript
import { validateHandleFormat } from '@/lib/handle-validation';

const result = validateHandleFormat('tomk');
console.log(result);
// { isValid: true }
```

### Test 3: Search Handles

```javascript
import { searchHandles } from '@/lib/handle-validation';

const results = await searchHandles('tom');
console.log(results);
// [{ id, handle, firstName, lastName, ... }]
```

---

## 🎯 Integration Points

### Signup Flow:
1. User enters name/email
2. Show HandleSelector component
3. Generate suggestions based on name
4. User picks handle
5. Create profile with handle

### Profile Display:
```typescript
<div>
  <h1>{profile.firstName} {profile.lastName}</h1>
  <p className="text-gray-500">@{profile.handle}</p>
</div>
```

### Post Creation:
```typescript
<MentionInput
  value={postText}
  onChange={setPostText}
  placeholder="What's happening? Use @ to mention athletes..."
/>
```

### Profile Links:
```typescript
<Link href={`/u/@${profile.handle}`}>
  @{profile.handle}
</Link>
```

---

## 🛠️ Troubleshooting

### Problem: "Handle already taken"
**Solution**: Check if it's reserved:
```sql
SELECT * FROM reserved_handles WHERE LOWER(handle) = 'yourhandle';
```

### Problem: "Can't change handle yet"
**Solution**: Check last change time:
```sql
SELECT handle, handle_updated_at FROM profiles WHERE id = 'user-id';
-- Wait 7 days from handle_updated_at
```

### Problem: "Invalid format"
**Solution**: Use validation:
```javascript
const validation = validateHandleFormat('your-handle');
console.log(validation.error);  // Shows specific issue
```

---

## 📊 Quick Stats

```sql
-- Total users with handles
SELECT COUNT(*) FROM profiles WHERE handle IS NOT NULL;

-- Most recent handles created
SELECT handle, created_at FROM profiles
ORDER BY created_at DESC LIMIT 10;

-- Handle change history
SELECT old_handle, new_handle, changed_at
FROM handle_history
ORDER BY changed_at DESC LIMIT 10;
```

---

## ✨ Pro Tips

1. **Auto-suggest on signup**: Use `generateHandleSuggestions()` from name/email
2. **Show handle in navigation**: Display @handle next to username
3. **Clickable mentions**: Parse text and link @handles to profiles
4. **Search rank**: Exact handle matches should rank highest
5. **Case preservation**: Store user's preferred casing (TomK vs tomk)

---

## 📚 Full Documentation

For detailed implementation guide, see:
```
HANDLE_SYSTEM_IMPLEMENTATION.md
```

For database setup details, see:
```
setup-handles-system.sql
```

For validation utilities, see:
```
src/lib/handle-validation.ts
```

---

Your handle system is ready! 🎉

**Next**: Build the UI components and integrate into your signup flow.
