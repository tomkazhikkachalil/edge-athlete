# Handle Migration Plan - Replace "full_name" with "@handle"

## Current State

**Problem**: Your app currently uses `full_name` as both:
1. Display name (e.g., "Tom Kazhikkachalil")
2. Username/handle (not unique, not @-prefixed)

This creates confusion because:
- ❌ `full_name` is not guaranteed unique
- ❌ No @ prefix (not Twitter-style)
- ❌ Can't have two "John Smith" users
- ❌ Hard to @mention people
- ❌ Profile URLs use user IDs, not memorable names

---

## Desired State

**Solution**: Separate concerns with unique `@handle` system:

```
Profile Structure:
├── first_name: "Tom"              ← Display name (changeable)
├── last_name: "Kazhikkachalil"   ← Display name (changeable)
└── handle: "tomk"                 ← Unique identifier (rate-limited)

Display:
- Name: "Tom Kazhikkachalil"       ← From first_name + last_name
- Handle: "@tomk"                   ← Unique identifier
```

**Result**:
- ✅ Unique @handle for every user
- ✅ Display name can change freely
- ✅ @mentions work reliably
- ✅ Profile URLs: `/u/@tomk`
- ✅ No duplicate identity confusion

---

## Migration Strategy

### Option 1: Keep Both (Recommended)

**What it means**:
- Keep `full_name` for display purposes (optional legacy field)
- Add `handle` as the unique identifier
- Update UI to show both where appropriate

**Display**:
```typescript
<div>
  <h1>Tom Kazhikkachalil</h1>          {/* first_name + last_name */}
  <p className="text-gray-500">@tomk</p>  {/* handle */}
</div>
```

**Pros**:
- ✅ No breaking changes
- ✅ Gradual migration
- ✅ Both identifiers available

**Cons**:
- ⚠️ Some confusion during transition
- ⚠️ Need to update many components

---

### Option 2: Replace Completely (Clean Break)

**What it means**:
- Repurpose `full_name` to store the handle
- Use `first_name + last_name` for display name only
- All existing code that uses `full_name` now gets the handle

**Before**:
```typescript
full_name: "Tom Kazhikkachalil"  // Display + identifier (confused)
```

**After**:
```typescript
full_name: "tomk"                    // Now stores handle
first_name: "Tom"                    // Display
last_name: "Kazhikkachalil"         // Display
handle: "tomk"                       // New unique field (same as full_name)
```

**Pros**:
- ✅ Clean data model
- ✅ Clear separation of concerns
- ✅ Less database columns

**Cons**:
- ⚠️ Requires updating all references
- ⚠️ Breaking change for existing code

---

## Recommended Approach: Progressive Migration

### Phase 1: Add Handle System (Done ✅)

You've already run `setup-handles-system.sql`, which:
- ✅ Added `handle` column to profiles
- ✅ Auto-generated handles for existing users
- ✅ Created validation and search functions
- ✅ Set up unique constraints

---

### Phase 2: Update Display Logic (Next Step)

**Current code pattern** (needs update):
```typescript
// OLD: Shows full_name as both name and handle
<div>
  <h1>{profile.full_name}</h1>
  <p>@{profile.full_name}</p>  {/* ❌ Not unique, confusing */}
</div>
```

**New code pattern** (recommended):
```typescript
// NEW: Separate display name and handle
import { formatDisplayName } from '@/lib/formatters';

<div>
  <h1>{formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}</h1>
  <p className="text-gray-500">@{profile.handle}</p>  {/* ✅ Unique handle */}
</div>
```

---

### Phase 3: Update Key Components

I'll show you exactly where to make changes:

#### 1. PostCard.tsx (Post Author)

**Current**:
```typescript
<span className="font-semibold">
  {formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
</span>
```

**Update to**:
```typescript
<div>
  <span className="font-semibold">
    {formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
  </span>
  {profile.handle && (
    <span className="ml-2 text-sm text-gray-500">
      @{profile.handle}
    </span>
  )}
</div>
```

---

#### 2. Profile Pages (Header)

**Current**:
```typescript
<h1 className="text-4xl font-bold">
  {formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
</h1>
```

**Update to**:
```typescript
<div>
  <h1 className="text-4xl font-bold">
    {formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
  </h1>
  {profile.handle && (
    <p className="text-xl text-gray-500 mt-1">
      @{profile.handle}
    </p>
  )}
</div>
```

---

#### 3. Search Results

**Current**:
```typescript
<div>
  <div className="font-medium">{athlete.full_name}</div>
  <div className="text-sm text-gray-500">{athlete.sport}</div>
</div>
```

**Update to**:
```typescript
<div>
  <div className="font-medium">
    {formatDisplayName(athlete.first_name, null, athlete.last_name, athlete.full_name)}
  </div>
  {athlete.handle && (
    <div className="text-sm text-gray-500">
      @{athlete.handle} {athlete.sport && `• ${athlete.sport}`}
    </div>
  )}
</div>
```

---

#### 4. Navigation/Header

**Current**:
```typescript
<span>Welcome, {profile.full_name}</span>
```

**Update to**:
```typescript
<div className="flex items-center gap-2">
  <span>Welcome, {profile.first_name}</span>
  {profile.handle && (
    <span className="text-sm text-gray-500">(@{profile.handle})</span>
  )}
</div>
```

---

#### 5. Profile URLs

**Current**:
```typescript
// Uses user ID
<Link href={`/athlete/${userId}`}>View Profile</Link>

// Or uses username (not unique)
<Link href={`/u/${profile.full_name}`}>View Profile</Link>
```

**Update to**:
```typescript
// Use handle (guaranteed unique)
<Link href={`/u/@${profile.handle}`}>View Profile</Link>

// Or without @ in URL
<Link href={`/u/${profile.handle}`}>View Profile</Link>
```

---

### Phase 4: Update Database Queries

Add `handle` to all profile queries:

**Before**:
```typescript
const { data } = await supabase
  .from('profiles')
  .select('id, first_name, last_name, full_name, avatar_url')
  .eq('id', userId);
```

**After**:
```typescript
const { data } = await supabase
  .from('profiles')
  .select('id, first_name, last_name, full_name, handle, avatar_url')  // Added handle
  .eq('id', userId);
```

---

## Quick Implementation Script

Let me create a utility to help with the transition:

**File**: `src/lib/profile-display.ts`

```typescript
import { formatDisplayName } from './formatters';

/**
 * Get user's display name (First Last)
 */
export function getDisplayName(profile: {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
}): string {
  return formatDisplayName(
    profile.first_name,
    null,  // No middle name
    profile.last_name,
    profile.full_name
  );
}

/**
 * Get user's handle with @ prefix
 */
export function getHandle(profile: {
  handle?: string | null;
}): string {
  if (!profile.handle) return '';
  return `@${profile.handle}`;
}

/**
 * Get user's handle without @ prefix (for URLs)
 */
export function getHandleRaw(profile: {
  handle?: string | null;
}): string {
  return profile.handle || '';
}

/**
 * Get profile URL using handle
 */
export function getProfileUrl(profile: {
  handle?: string | null;
  id?: string;
}): string {
  if (profile.handle) {
    return `/u/@${profile.handle}`;
  }
  // Fallback to ID-based URL
  return `/athlete/${profile.id}`;
}

/**
 * Format user identifier for display
 * Shows: "Tom Kazhikkachalil @tomk"
 */
export function getFullIdentifier(profile: {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  handle?: string | null;
}): string {
  const displayName = getDisplayName(profile);
  const handle = getHandle(profile);

  if (handle) {
    return `${displayName} ${handle}`;
  }
  return displayName;
}
```

---

## Component Update Checklist

Update these files to show handles:

### High Priority:
- [ ] **PostCard.tsx** - Show @handle under post author
- [ ] **src/app/athlete/page.tsx** - Show @handle on profile header
- [ ] **SearchBar.tsx** - Show @handle in search results
- [ ] **NotificationsDropdown.tsx** - Show @handle in notifications
- [ ] **FollowButton.tsx** - Use handle for display
- [ ] **EditProfileTabs.tsx** - Add handle change form

### Medium Priority:
- [ ] **CommentSection.tsx** - Show @handle on comments
- [ ] **CreatePostModal.tsx** - Use @mention autocomplete
- [ ] **MobileNav.tsx** - Show @handle in nav
- [ ] **PrivateProfileView.tsx** - Show @handle on restricted profiles

### Low Priority:
- [ ] **RecentPosts.tsx** - Show @handle
- [ ] **ConnectionSuggestions.tsx** - Show @handle
- [ ] **TagPeopleModal.tsx** - Use @handle for tagging

---

## Visual Design Patterns

### Pattern 1: Inline (Compact)
```
Tom Kazhikkachalil @tomk
```

```typescript
<span>
  {getDisplayName(profile)}
  <span className="text-gray-500 ml-2">{getHandle(profile)}</span>
</span>
```

---

### Pattern 2: Stacked (Profile Header)
```
Tom Kazhikkachalil
@tomk
```

```typescript
<div>
  <h1 className="text-4xl font-bold">{getDisplayName(profile)}</h1>
  <p className="text-xl text-gray-500">{getHandle(profile)}</p>
</div>
```

---

### Pattern 3: Badge Style
```
Tom Kazhikkachalil [@tomk]
```

```typescript
<span>
  {getDisplayName(profile)}
  {profile.handle && (
    <span className="ml-2 px-2 py-1 bg-gray-100 rounded text-sm">
      @{profile.handle}
    </span>
  )}
</span>
```

---

### Pattern 4: Card (Search/List)
```
┌─────────────────────────┐
│ [Avatar] Tom K          │
│          @tomk          │
│          Golf • Harvard │
└─────────────────────────┘
```

```typescript
<div className="flex items-start gap-3">
  <img src={avatar} className="w-12 h-12 rounded-full" />
  <div>
    <div className="font-semibold">{getDisplayName(profile)}</div>
    <div className="text-sm text-gray-500">{getHandle(profile)}</div>
    <div className="text-xs text-gray-400">{sport} • {school}</div>
  </div>
</div>
```

---

## Testing Checklist

After migration:

- [ ] All profiles have unique handles
- [ ] Display names show correctly (First Last)
- [ ] @handles show everywhere usernames did
- [ ] Profile URLs work: `/u/@tomk`
- [ ] Search finds users by handle
- [ ] @mentions work in posts/comments
- [ ] Can change handle in settings
- [ ] Rate limit works (1 change per 7 days)
- [ ] Old profile URLs still work (redirect)

---

## Rollout Plan

### Week 1: Backend
- ✅ Run `setup-handles-system.sql`
- ✅ Verify all users have handles
- ✅ Test API endpoints

### Week 2: UI Updates
- [ ] Update profile display components
- [ ] Add @handle to post cards
- [ ] Add @handle to search results
- [ ] Update navigation

### Week 3: Advanced Features
- [ ] Add handle change form to settings
- [ ] Implement @mention autocomplete
- [ ] Update profile URLs
- [ ] Add handle to signup flow

### Week 4: Polish
- [ ] Test everything
- [ ] Fix edge cases
- [ ] Update documentation
- [ ] Train users on new system

---

## Key Takeaway

**Current**: `full_name` = "Tom Kazhikkachalil" (not unique)

**Future**:
- Display Name = "Tom Kazhikkachalil" (from `first_name` + `last_name`)
- Handle = "@tomk" (from `handle` column, guaranteed unique)

**Result**: Clear separation between identity (handle) and display preference (name).

---

Ready to implement? Start with Phase 2 (updating display logic in key components). Let me know which component you want to tackle first!
