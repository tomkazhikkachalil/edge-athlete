# Privacy System Architecture

## Design Principles

### 1. Simple User Experience
- **Binary choice**: Public or Private (clear, not overwhelming)
- **Single toggle**: One switch controls visibility
- **Clear indicators**: Users always know their privacy status
- **Smart defaults**: Public for athletes (promotes discovery), changeable anytime

### 2. Scalability & Future-Proofing
- **Granular ready**: Database schema supports future fine-grained control
- **Sport-agnostic**: Works for golf, basketball, all future sports
- **Content-type flexible**: Can later split into media privacy, stats privacy, etc.
- **Relationship-aware**: Foundation for friends/followers-only features

### 3. Seamless Experience
- **For profile owners**: Easy toggle in settings, instant effect
- **For viewers**: Clear messaging when content is private
- **For developers**: Clean API, enforced at database level

---

## Database Schema Design

### Core Privacy Model

```sql
-- Add privacy columns to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS visibility TEXT
  DEFAULT 'public'
  CHECK (visibility IN ('public', 'private'));

-- Add granular privacy settings (future-proof, optional)
CREATE TABLE IF NOT EXISTS privacy_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

  -- Current: Simple public/private
  profile_visibility TEXT DEFAULT 'public' CHECK (profile_visibility IN ('public', 'private')),

  -- Future: Granular controls (for later)
  media_visibility TEXT DEFAULT 'inherit' CHECK (media_visibility IN ('public', 'private', 'friends', 'inherit')),
  stats_visibility TEXT DEFAULT 'inherit' CHECK (stats_visibility IN ('public', 'private', 'friends', 'inherit')),
  posts_visibility TEXT DEFAULT 'inherit' CHECK (posts_visibility IN ('public', 'private', 'friends', 'inherit')),
  activity_visibility TEXT DEFAULT 'inherit' CHECK (activity_visibility IN ('public', 'private', 'friends', 'inherit')),

  -- 'inherit' means use profile_visibility setting

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_profiles_visibility ON profiles(visibility);
CREATE INDEX IF NOT EXISTS idx_privacy_settings_profile ON privacy_settings(profile_id);
```

**Why this design?**
- ✅ Simple now: Just use `profiles.visibility` column
- ✅ Scalable later: Add `privacy_settings` for granular control
- ✅ Backward compatible: Default 'inherit' means "use main setting"
- ✅ No breaking changes when adding features

---

## Access Control Levels

### Phase 1: Public/Private (Current Implementation)

| Visibility | Who Can View | What They See |
|------------|--------------|---------------|
| **Public** | Everyone (logged in) | Full profile, all posts, stats, media |
| **Private** | Owner + Approved followers | Full profile, all posts, stats, media |
|            | Others | Basic info only (name, sport, "Profile is private") |

### Phase 2: Granular Controls (Future)

```typescript
// Example future structure
interface PrivacySettings {
  profile_visibility: 'public' | 'private';
  media_visibility: 'public' | 'private' | 'friends' | 'inherit';
  stats_visibility: 'public' | 'private' | 'friends' | 'inherit';
  posts_visibility: 'public' | 'private' | 'friends' | 'inherit';
  activity_visibility: 'public' | 'private' | 'friends' | 'inherit';
}

// 'inherit' = use profile_visibility
```

This allows future scenarios like:
- "My profile is public, but stats are friends-only"
- "Everything public except my media"
- "Profile private, but highlight reels public"

---

## RLS (Row Level Security) Implementation

### Updated Policies

```sql
-- PROFILES TABLE
-- Public profiles viewable by all authenticated users
-- Private profiles viewable by owner + followers
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON profiles;

CREATE POLICY "Users can view profiles based on visibility" ON profiles
  FOR SELECT USING (
    -- Own profile
    auth.uid() = id
    OR
    -- Public profiles
    visibility = 'public'
    OR
    -- Private profiles if you follow them
    (visibility = 'private' AND EXISTS (
      SELECT 1 FROM follows
      WHERE follows.follower_id = auth.uid()
        AND follows.following_id = profiles.id
        AND follows.status = 'accepted'
    ))
  );

-- POSTS TABLE
-- Public posts visible to all
-- Private profile posts only visible to followers
DROP POLICY IF EXISTS "Users can view posts" ON posts;

CREATE POLICY "Users can view posts based on profile visibility" ON posts
  FOR SELECT USING (
    -- Own posts
    profile_id = auth.uid()
    OR
    -- Public posts from public profiles
    (visibility = 'public' AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = posts.profile_id
        AND profiles.visibility = 'public'
    ))
    OR
    -- Posts from private profiles if you follow them
    EXISTS (
      SELECT 1 FROM profiles
      JOIN follows ON follows.following_id = profiles.id
      WHERE profiles.id = posts.profile_id
        AND profiles.visibility = 'private'
        AND follows.follower_id = auth.uid()
        AND follows.status = 'accepted'
    )
  );

-- GOLF ROUNDS TABLE
-- Similar pattern: viewable based on profile privacy
CREATE POLICY "Users can view golf rounds based on profile visibility" ON golf_rounds
  FOR SELECT USING (
    -- Own rounds
    profile_id = auth.uid()
    OR
    -- Rounds from public profiles
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = golf_rounds.profile_id
        AND profiles.visibility = 'public'
    )
    OR
    -- Rounds from private profiles if following
    EXISTS (
      SELECT 1 FROM profiles
      JOIN follows ON follows.following_id = profiles.id
      WHERE profiles.id = golf_rounds.profile_id
        AND profiles.visibility = 'private'
        AND follows.follower_id = auth.uid()
        AND follows.status = 'accepted'
    )
  );

-- Same pattern applies to:
-- - season_highlights
-- - performances
-- - athlete_badges
-- - etc.
```

---

## API Layer

### Helper Functions

```typescript
// src/lib/privacy.ts

import { supabase } from './supabase';

export type ProfileVisibility = 'public' | 'private';

/**
 * Check if current user can view a profile
 */
export async function canViewProfile(
  profileId: string,
  currentUserId: string
): Promise<boolean> {
  // Own profile - always true
  if (profileId === currentUserId) return true;

  // Check profile visibility
  const { data: profile } = await supabase
    .from('profiles')
    .select('visibility')
    .eq('id', profileId)
    .single();

  if (!profile) return false;

  // Public profile - anyone can view
  if (profile.visibility === 'public') return true;

  // Private profile - check if following
  const { data: followRelation } = await supabase
    .from('follows')
    .select('status')
    .eq('follower_id', currentUserId)
    .eq('following_id', profileId)
    .single();

  return followRelation?.status === 'accepted';
}

/**
 * Get privacy-aware profile data
 */
export async function getProfileWithPrivacy(
  profileId: string,
  currentUserId: string
) {
  const canView = await canViewProfile(profileId, currentUserId);

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', profileId)
    .single();

  if (!profile) return null;

  // If can't view, return limited data
  if (!canView) {
    return {
      id: profile.id,
      full_name: profile.full_name,
      first_name: profile.first_name,
      last_name: profile.last_name,
      avatar_url: profile.avatar_url,
      sport: profile.sport,
      visibility: profile.visibility,
      isPrivate: true,
      limitedAccess: true
    };
  }

  // Full access
  return {
    ...profile,
    isPrivate: false,
    limitedAccess: false
  };
}
```

---

## UI Components

### 1. Privacy Toggle (Settings)

```tsx
// In EditProfileTabs.tsx - Basic Info tab

<div className="mb-6">
  <label className="flex items-center justify-between p-4 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 transition">
    <div className="flex-1">
      <div className="font-medium text-gray-900">Profile Visibility</div>
      <div className="text-sm text-gray-500 mt-1">
        {visibility === 'public'
          ? 'Anyone can view your profile and posts'
          : 'Only approved followers can view your profile and posts'
        }
      </div>
    </div>
    <div className="ml-4">
      <button
        type="button"
        onClick={() => setVisibility(visibility === 'public' ? 'private' : 'public')}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          visibility === 'public' ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          visibility === 'public' ? 'translate-x-6' : 'translate-x-1'
        }`} />
      </button>
    </div>
  </label>

  {/* Visual indicator */}
  <div className="mt-2 text-center">
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
      visibility === 'public'
        ? 'bg-green-100 text-green-700'
        : 'bg-orange-100 text-orange-700'
    }`}>
      <i className={`fas fa-${visibility === 'public' ? 'globe' : 'lock'}`}></i>
      {visibility === 'public' ? 'Public Profile' : 'Private Profile'}
    </span>
  </div>
</div>
```

### 2. Privacy Badge (Profile View)

```tsx
// Show on profile header when viewing own profile

{user?.id === profile?.id && (
  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
    <i className={`fas fa-${profile.visibility === 'public' ? 'globe' : 'lock'}`}></i>
    {profile.visibility === 'public' ? 'Public' : 'Private'}
  </div>
)}
```

### 3. Private Profile View (For Non-Followers)

```tsx
// When viewing someone's private profile you don't follow

{limitedAccess && (
  <div className="max-w-2xl mx-auto mt-12">
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
      <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <i className="fas fa-lock text-3xl text-gray-400"></i>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-3">
        This Profile is Private
      </h2>

      <p className="text-gray-600 mb-6">
        Follow {profile.first_name || 'this athlete'} to see their posts, stats, and activity
      </p>

      <div className="flex items-center justify-center gap-4">
        {profile.avatar_url ? (
          <img src={profile.avatar_url} className="w-16 h-16 rounded-full" />
        ) : (
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
            <span className="text-white text-xl font-semibold">
              {getInitials(profile.full_name)}
            </span>
          </div>
        )}

        <div className="text-left">
          <div className="font-bold text-lg text-gray-900">
            {formatDisplayName(profile.full_name, profile.first_name, profile.last_name)}
          </div>
          <div className="text-gray-600 text-sm">
            {profile.sport}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <FollowButton
          profileId={profile.id}
          initialFollowing={false}
          onFollowChange={(following) => {
            if (following) {
              showSuccess('Follow request sent!', 'You\'ll see their content when they approve');
            }
          }}
        />
      </div>
    </div>
  </div>
)}
```

---

## Search Behavior

### Search Results

Private profiles still appear in search (for discoverability), but with indicators:

```tsx
// In SearchBar results

{results.athletes.map((athlete) => (
  <div key={athlete.id} className="flex items-center gap-3 p-3">
    {/* Avatar and name */}

    {athlete.visibility === 'private' && (
      <span className="text-xs text-gray-500 flex items-center gap-1">
        <i className="fas fa-lock"></i>
        Private
      </span>
    )}
  </div>
))}
```

---

## Migration Path

### Phase 1: Simple Public/Private (Sprint 1)
- ✅ Add `visibility` column to profiles
- ✅ Update RLS policies
- ✅ Add toggle to settings
- ✅ Show privacy indicators
- ✅ Enforce in profile views

### Phase 2: Granular Controls (Future Sprint)
- Add `privacy_settings` table
- UI for fine-grained controls
- Update RLS policies to check granular settings
- API helpers for each content type

### Phase 3: Friend Lists (Future Sprint)
- Add friend relationships (separate from follows)
- "Friends-only" visibility option
- Friend management UI

---

## Default Privacy Strategy

### For New Users
```typescript
// During signup/onboarding
const defaultVisibility = 'public'; // Promotes discovery

// Can be changed immediately in profile settings
```

### Onboarding Flow
```tsx
// Optional: Ask during profile creation

<div className="mb-6">
  <h3 className="font-bold text-lg mb-3">Choose Your Privacy</h3>

  <div className="space-y-3">
    <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50">
      <input type="radio" name="visibility" value="public" defaultChecked />
      <div>
        <div className="font-medium">Public Profile (Recommended)</div>
        <div className="text-sm text-gray-600">Let everyone discover you and your achievements</div>
      </div>
    </label>

    <label className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50">
      <input type="radio" name="visibility" value="private" />
      <div>
        <div className="font-medium">Private Profile</div>
        <div className="text-sm text-gray-600">Only approved followers see your content</div>
      </div>
    </label>
  </div>

  <p className="text-xs text-gray-500 mt-3">
    You can change this anytime in settings
  </p>
</div>
```

---

## Edge Cases & Considerations

### 1. Existing Followers
When switching to private:
- Existing followers keep access
- New follow requests require approval

### 2. Posts Visibility
- Post `visibility` field still honored
- Private profile + public post = still requires follow
- Public profile + private post = not shown

### 3. Search & Discovery
- Private profiles appear in search (name, sport)
- But limited info shown
- Encourages following

### 4. Direct Links
- Sharing profile URL when private shows limited view
- "This profile is private" message

### 5. Golf Rounds / Stats
- Linked to profile privacy
- Private profile = private stats
- Even if post is public

---

## Performance Considerations

### Database Indexes
```sql
-- Already recommended above
CREATE INDEX idx_profiles_visibility ON profiles(visibility);
CREATE INDEX idx_follows_lookup ON follows(follower_id, following_id, status);
```

### Caching Strategy
```typescript
// Cache visibility check results (short TTL)
const CACHE_KEY = `profile:${profileId}:visibility`;
const CACHE_TTL = 60; // 1 minute

// Use Redis or in-memory cache
```

---

## Testing Checklist

### Privacy Enforcement
- [ ] Public profile visible to all
- [ ] Private profile hidden from non-followers
- [ ] Private profile visible to followers
- [ ] Owner always sees own content
- [ ] RLS policies enforce at database level
- [ ] API respects privacy settings
- [ ] Search shows appropriate results
- [ ] Direct links respect privacy

### UI/UX
- [ ] Toggle is clear and obvious
- [ ] Privacy badge shows on profile
- [ ] "Private profile" message is friendly
- [ ] Follow button prominent on private profiles
- [ ] Settings save immediately
- [ ] No flash of private content

### Edge Cases
- [ ] Switching public → private works
- [ ] Switching private → public works
- [ ] Existing followers retain access
- [ ] Unfollowing removes access
- [ ] Search still shows limited info
- [ ] Direct links work correctly

---

This architecture provides:
✅ Simple user experience (one toggle)
✅ Scalable to granular controls
✅ Sport-agnostic design
✅ Database-enforced security
✅ Clean API abstractions
✅ Future-proof schema
