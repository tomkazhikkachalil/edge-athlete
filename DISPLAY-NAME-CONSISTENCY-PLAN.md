# Global Display Name Consistency - Implementation Plan

## ✅ Completed

### 1. Created Centralized Name Resolver ✅
**File:** `src/lib/name-resolver.ts`

**Key Functions:**
- `resolveDisplayName(profile)` - Core resolver, returns `{displayName, handle, source}`
- `getDisplayName(profile)` - Convenience function, just returns the string
- `getHandle(profile)` - Gets the @handle for mentions/URLs
- `truncateDisplayName()` - Consistent truncation across all surfaces
- `validateDisplayName()` - Validation with sanitization
- `resolveDisplayNameWithPrivacy()` - Privacy-aware resolution

**Rules Implemented:**
1. ✅ `display_name` is the single source of truth
2. ✅ Falls back to constructed name (first + middle + last)
3. ✅ Falls back to username/handle
4. ✅ Final fallback: "Unknown User"

### 2. Database Migration Ready ✅
**File:** `add-display-name-field.sql`

**What it does:**
- ✅ Adds `display_name` column to profiles table
- ✅ Backfills existing profiles (name > username > fallback)
- ✅ Creates index for performance
- ✅ Updates search_vector to include display_name
- ✅ Creates auto-sync trigger when names change
- ✅ Adds NOT NULL constraint

---

## 📋 Next Steps (To Do)

### Step 3: Update Profile TypeScript Interface

**File:** `src/lib/supabase.ts`

Add `display_name` to the Profile interface:

```typescript
export interface Profile {
  id: string;
  email: string;
  display_name: string;  // ← ADD THIS (required after migration)
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  full_name?: string;  // username/handle
  username?: string;
  // ... rest of fields
}
```

### Step 4: Audit Codebase for Direct Name Access

**Search for these patterns:**

```bash
# Find files that access name fields directly
grep -r "profile\.first_name" src/
grep -r "profile\.last_name" src/
grep -r "profile\.full_name" src/
grep -r "formatDisplayName" src/
```

**Files to update (likely candidates):**

1. **Components:**
   - `src/components/PostCard.tsx`
   - `src/components/NotificationBell.tsx`
   - `src/components/SearchBar.tsx`
   - `src/components/AdvancedSearchBar.tsx`
   - `src/components/TagPeopleModal.tsx`
   - `src/components/TaggedPosts.tsx`
   - `src/components/FollowButton.tsx`
   - `src/components/EditProfileTabs.tsx`

2. **Pages:**
   - `src/app/athlete/page.tsx`
   - `src/app/u/[username]/page.tsx`
   - `src/app/feed/page.tsx`
   - `src/app/app/followers/page.tsx`
   - `src/app/notifications/page.tsx`

3. **API Routes:**
   - `src/app/api/posts/route.ts`
   - `src/app/api/search/route.ts`
   - `src/app/api/comments/route.ts`
   - `src/app/api/notifications/route.ts`
   - `src/app/api/followers/route.ts`

### Step 5: Update API Responses

**Pattern to follow:**

```typescript
// BEFORE (bad - exposing raw fields)
{
  user: {
    id: "...",
    first_name: "John",
    last_name: "Doe",
    full_name: "johndoe"
  }
}

// AFTER (good - using resolver)
import { resolveDisplayName } from '@/lib/name-resolver';

const resolved = resolveDisplayName(user);

{
  user: {
    id: "...",
    displayName: resolved.displayName,  // "John Doe"
    handle: resolved.handle,            // "johndoe"
    // Legacy fields (mark as deprecated)
    first_name: user.first_name,  // @deprecated
    last_name: user.last_name,    // @deprecated
  }
}
```

### Step 6: Update UI Components

**Replace all instances of:**

```typescript
// OLD
import { formatDisplayName } from '@/lib/formatters';

const displayName = formatDisplayName(
  profile.first_name,
  profile.middle_name,
  profile.last_name,
  profile.full_name
);
```

**With:**

```typescript
// NEW
import { getDisplayName } from '@/lib/name-resolver';

const displayName = getDisplayName(profile);
```

**Example updates:**

```typescript
// PostCard.tsx - Author name
const displayName = getDisplayName(post.profile);

// TagPeopleModal.tsx - Search results
<span>{getDisplayName(profile)}</span>

// NotificationBell.tsx - Actor name
const actorName = getDisplayName(notification.actor_profile);
```

### Step 7: Add Display Name to Profile Edit

**File:** `src/components/EditProfileTabs.tsx`

Add a new field for `display_name`:

```typescript
<div className="mb-4">
  <label className="block text-sm font-medium text-gray-700 mb-2">
    Display Name
    <span className="text-gray-500 text-xs ml-2">
      (How your name appears to others)
    </span>
  </label>
  <input
    type="text"
    value={displayName}
    onChange={(e) => {
      const validation = validateDisplayName(e.target.value);
      if (validation.valid) {
        setDisplayName(validation.sanitized!);
        setDisplayNameError(undefined);
      } else {
        setDisplayNameError(validation.error);
      }
    }}
    maxLength={100}
    className="w-full px-4 py-2 border rounded-lg"
  />
  {displayNameError && (
    <p className="text-red-600 text-sm mt-1">{displayNameError}</p>
  )}
  <p className="text-gray-500 text-xs mt-1">
    Current: <strong>{getDisplayName(profile)}</strong>
  </p>
</div>
```

### Step 8: Cache Invalidation Strategy

**Create:** `src/lib/name-cache.ts`

```typescript
import { getDisplayNameCacheKey } from './name-resolver';

// In-memory cache (for server-side)
const nameCache = new Map<string, {name: string, version: string, expires: number}>();

export function cacheDisplayName(profileId: string, name: string, version: string) {
  const key = getDisplayNameCacheKey(profileId);
  nameCache.set(key, {
    name,
    version,
    expires: Date.now() + (5 * 60 * 1000) // 5 min TTL
  });
}

export function getCachedDisplayName(profileId: string, requiredVersion?: string): string | null {
  const key = getDisplayNameCacheKey(profileId);
  const cached = nameCache.get(key);

  if (!cached) return null;
  if (Date.now() > cached.expires) {
    nameCache.delete(key);
    return null;
  }
  if (requiredVersion && cached.version !== requiredVersion) {
    nameCache.delete(key);
    return null;
  }

  return cached.name;
}

export function invalidateDisplayNameCache(profileId: string) {
  const key = getDisplayNameCacheKey(profileId);
  nameCache.delete(key);
}
```

**Integrate cache invalidation:**

```typescript
// When profile is updated
await supabase.from('profiles').update({
  display_name: newDisplayName
}).eq('id', userId);

// Invalidate cache
invalidateDisplayNameCache(userId);
```

### Step 9: Backfill Denormalized Data

**Create:** `backfill-display-names.sql`

```sql
-- Update denormalized user blobs in posts, notifications, etc.
-- This depends on your schema - examples:

-- If you store author name in posts (denormalized)
UPDATE posts p
SET cached_author_name = (
  SELECT display_name
  FROM profiles pr
  WHERE pr.id = p.profile_id
)
WHERE cached_author_name IS NULL OR cached_author_name != (
  SELECT display_name FROM profiles WHERE id = p.profile_id
);

-- If you have a search index table
UPDATE search_index si
SET user_display_name = (
  SELECT display_name FROM profiles WHERE id = si.user_id
);
```

### Step 10: Add Linter Rule

**Create:** `.eslintrc-name-access.json`

```json
{
  "rules": {
    "no-restricted-properties": ["error", {
      "object": "profile",
      "property": "first_name",
      "message": "Use getDisplayName(profile) instead of accessing first_name directly"
    }, {
      "object": "profile",
      "property": "last_name",
      "message": "Use getDisplayName(profile) instead of accessing last_name directly"
    }, {
      "object": "profile",
      "property": "full_name",
      "message": "Use getHandle(profile) for handles, getDisplayName(profile) for display"
    }]
  }
}
```

---

## 🧪 Testing Checklist

### Before Migration:
- [ ] Run `add-display-name-field.sql` in Supabase
- [ ] Verify all profiles have display_name populated
- [ ] Check search still works with display_name

### After Code Updates:
- [ ] Main feed shows display names correctly
- [ ] Post author names use resolver
- [ ] Comments show correct names
- [ ] Notifications show correct names
- [ ] Search results use resolver
- [ ] Tag people modal uses resolver
- [ ] Profile edit allows changing display_name
- [ ] Changing display_name updates everywhere
- [ ] Private/blocked users show masked names

### Cache Validation:
- [ ] Display name changes propagate within 5 min
- [ ] Old names don't appear after cache expiry
- [ ] Search finds users by new display_name
- [ ] Emails use current display_name

---

## 📊 Observability

### Metrics to Track:

1. **Resolver Usage:**
   ```typescript
   console.log('[NAME_RESOLVER] Resolved:', profile.id, resolved.source);
   ```

2. **Cache Hit Rate:**
   ```typescript
   const hit = getCachedDisplayName(profileId);
   logMetric('name_cache_hit', hit ? 1 : 0);
   ```

3. **Legacy Access (should be 0):**
   ```typescript
   // Add temporary logging
   if (code accesses first_name directly) {
     console.warn('[NAME_RESOLVER] Legacy access detected:', file, line);
   }
   ```

### Dashboard Panels:
- Display name resolution by source (display_name vs constructed vs username)
- Cache hit rate over time
- Legacy field access count (should trend to 0)
- Display name update frequency

---

## 🚀 Deployment Plan

### Phase 1: Database (Low Risk)
1. Run `add-display-name-field.sql`
2. Verify backfill completed
3. Monitor for any NULL display_names
4. **No code changes yet** - just schema prep

### Phase 2: Add Resolver (No Breaking Changes)
1. Deploy `name-resolver.ts`
2. Update TypeScript interface to include display_name
3. No frontend changes yet - just library available
4. **Backward compatible**

### Phase 3: Update APIs (Gradual)
1. Update one API route at a time
2. Include both `displayName` (new) and legacy fields
3. Mark legacy fields as `@deprecated`
4. Deploy incrementally, monitor for errors

### Phase 4: Update UI (Component by Component)
1. Start with low-traffic components
2. Replace formatDisplayName with getDisplayName
3. Test thoroughly in staging
4. Deploy one component at a time
5. Monitor for display issues

### Phase 5: Remove Legacy (Final)
1. Remove deprecated fields from API responses
2. Remove formatDisplayName function (replace with getDisplayName)
3. Update ESLint to block legacy access
4. Clean up old code

---

## 📚 Documentation

**For Developers:**
- Never access `first_name`, `last_name`, `full_name` directly for display
- Always use `getDisplayName(profile)` from `name-resolver.ts`
- Use `getHandle(profile)` for @mentions and URLs
- Update display_name in profile settings, not constructed names

**For Users:**
- Display Name: What everyone sees
- Username/Handle: For @mentions and your profile URL
- Legal Name (first/middle/last): Private, for verification only

---

## ✅ Success Criteria

1. ✅ All user displays use `getDisplayName()`
2. ✅ Zero direct access to first_name/last_name for display
3. ✅ Display name changes propagate everywhere within 5 min
4. ✅ Search works with display_name
5. ✅ No console errors from missing fields
6. ✅ ESLint blocks new legacy access
7. ✅ All tests pass with new resolver
8. ✅ Performance is same or better (caching)

---

**Status:** Ready to implement - start with database migration!
