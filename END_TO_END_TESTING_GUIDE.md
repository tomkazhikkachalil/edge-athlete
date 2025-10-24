# End-to-End Data Wiring Verification Guide

## Objective

Confirm that a newly created user/profile can perform all core actions and that every record is persisted and linked to the correct user/profile in the database. This validates both UI behavior and data associations.

---

## A) Test Setup (Clean Seed)

### Step 1: Create Test User

1. **Navigate to the homepage** and click "Sign Up"
2. **Fill out the signup form:**
   - Email: `test_golfer_01@example.com`
   - Password: `TestPass123!`
   - First Name: `Test`
   - Last Name: `Golfer`
   - Handle: `test_golfer_01`
   - Complete any other required fields

3. **Complete signup** and verify you're logged in

### Step 2: Record Test User IDs

**From Browser DevTools Console:**

```javascript
// Open browser console (F12) and run:
localStorage.getItem('supabase.auth.token')

// Or check the application state
// Look in Network tab for API responses containing your user data
```

**What to Record:**
- `user_id` (auth ID) - Should be a UUID
- `profile_id` (profiles table) - Same as user_id
- `handle` - @test_golfer_01

**Create a test tracking document:**

```
Test User Details:
- Email: test_golfer_01@example.com
- User ID: [UUID HERE]
- Profile ID: [SAME UUID]
- Handle: @test_golfer_01
- Created: [TIMESTAMP]
```

### Step 3: Verify Profile is Public

1. Go to Settings → Profile Information
2. Verify "Privacy" is set to **Public** (for baseline testing)
3. If private, toggle to Public

---

## B) Actions to Perform (Happy Path)

### 1) Profile Setup & Edits

**Steps:**
1. Navigate to **Settings → Profile Information**
2. Update the following:
   - Upload an avatar image
   - Update bio/description
   - Verify first name, last name, handle are correct
3. Navigate to **Settings → Golf Settings** (or your sport tab)
4. Add golf-specific settings:
   - Handicap: `12`
   - Home Course: `Pebble Beach`
   - Tee Preference: `White`
   - Dominant Hand: `Right`
5. Click **Save Changes**

**Expected Result:**
- ✅ Changes save successfully
- ✅ Avatar appears in header
- ✅ Golf settings persist when you reload the page

**Verification Checkpoint:**
```sql
-- Run in Supabase SQL Editor (replace YOUR_PROFILE_ID)
SELECT * FROM profiles WHERE id = 'YOUR_PROFILE_ID';
SELECT * FROM sport_settings WHERE profile_id = 'YOUR_PROFILE_ID';
```

---

### 2) Posts Creation

Create **three different posts** to test all post types:

#### Post 1: Text + Media (Photo)
1. Click **Create Post** button
2. Select post type: **General** (or your default)
3. Add caption: "First day at the course! ⛳"
4. Add hashtags: `#golf #training`
5. Upload 1-2 photos
6. Click **Create Post**

**Expected:** Post appears in feed with photos

#### Post 2: Stats-Only (Golf Round)
1. Click **Create Post** button
2. Select post type: **Golf**
3. **Do NOT add caption or media**
4. Fill out golf scorecard:
   - Course: "Pine Valley Golf Club"
   - Date: Today
   - Holes: 18
   - Round Type: Outdoor
   - Enter scores for at least 9 holes
5. Click **Create Post**

**Expected:** Post appears in feed with scorecard preview

#### Post 3: Text-Only (No Media/Stats)
1. Click **Create Post** button
2. Select post type: **General**
3. Add caption: "Great practice session today! Feeling confident for the tournament."
4. Add hashtags: `#motivation #golf`
5. **Do NOT add media or stats**
6. Click **Create Post**

**Expected:** Post appears in feed with just text

**Verification Checkpoint:**
```sql
-- Verify all 3 posts exist and are linked correctly
SELECT
  id,
  profile_id,
  sport_key,
  caption,
  round_id,
  created_at,
  CASE WHEN profile_id = 'YOUR_PROFILE_ID' THEN '✅' ELSE '⛔' END as owner_check
FROM posts
WHERE profile_id = 'YOUR_PROFILE_ID'
ORDER BY created_at DESC;
```

---

### 3) Media Uploads Verification

**Steps:**
1. Navigate to your **Profile Page**
2. Click **All Media** tab
3. Verify you see the photo(s) from Post 1
4. Click **Media with Stats** tab
5. Verify you see the golf round from Post 2

**Expected Result:**
- ✅ All media appears correctly
- ✅ Stats-only post shows scorecard summary
- ✅ Clicking on media opens full view

**Verification Checkpoint:**
```sql
-- Verify media records
SELECT
  pm.id,
  pm.post_id,
  pm.media_url,
  pm.media_type,
  p.profile_id,
  CASE WHEN p.profile_id = 'YOUR_PROFILE_ID' THEN '✅' ELSE '⛔' END as owner_check
FROM post_media pm
JOIN posts p ON p.id = pm.post_id
WHERE p.profile_id = 'YOUR_PROFILE_ID';
```

---

### 4) Follow Flow Testing

**Setup: Create Second Test User**
1. Open an **Incognito/Private Browser Window**
2. Sign up as: `viewer_02@example.com` / `ViewerPass123!`
3. Handle: `viewer_02`
4. Complete profile setup

**Test Follow Flow:**

#### If Profile is Public:
1. From `viewer_02` account, search for `@test_golfer_01`
2. Click on their profile
3. Click **Follow** button
4. Verify button changes to **Following**

**Expected:**
- ✅ Follow is immediate (status = 'accepted')
- ✅ test_golfer_01 sees a "new_follower" notification
- ✅ viewer_02 appears in test_golfer_01's followers list

#### If Profile is Private:
1. Set test_golfer_01 to **Private** in settings
2. From `viewer_02` account, try to follow
3. Verify button shows **Requested**

**Expected:**
- ✅ Follow status = 'pending'
- ✅ test_golfer_01 sees a "follow_request" notification
- ✅ test_golfer_01 can accept/deny the request

**Verification Checkpoint:**
```sql
-- Check follow relationship
SELECT
  f.id,
  f.follower_id,
  f.following_id,
  f.status,
  follower.handle as follower_handle,
  following.handle as following_handle,
  CASE
    WHEN f.following_id = 'YOUR_PROFILE_ID' THEN '✅ Correct Direction'
    ELSE '⛔ Wrong Direction'
  END as relationship_check
FROM follows f
JOIN profiles follower ON follower.id = f.follower_id
JOIN profiles following ON following.id = f.following_id
WHERE f.following_id = 'YOUR_PROFILE_ID'
   OR f.follower_id = 'YOUR_PROFILE_ID';
```

---

### 5) Likes & Comments Testing

**From viewer_02 account:**

#### Like All Three Posts
1. Navigate to test_golfer_01's profile or feed
2. Click ❤️ (heart) on each of the 3 posts
3. Verify heart turns red and count increments

**Expected:**
- ✅ Like count increments immediately
- ✅ test_golfer_01 receives notification for each like

#### Comment on Each Post
1. Click on the first post (text+media)
2. Add comment: "Great photos! 📸"
3. Click **Post Comment**
4. Repeat for the other 2 posts:
   - Post 2: "Nice round! What was your score?"
   - Post 3: "Good luck at the tournament! 🎯"

**Expected:**
- ✅ Comments appear immediately
- ✅ test_golfer_01 receives notification for each comment

**From test_golfer_01 account:**

#### Reply to One Comment
1. Check notifications - should see 3 comment notifications
2. Click on one notification to go to the post
3. Click **Reply** on viewer_02's comment
4. Type: "Thanks! Scored a 74."
5. Post the reply

**Expected:**
- ✅ Reply appears threaded under original comment
- ✅ viewer_02 receives notification about the reply

**Verification Checkpoint:**
```sql
-- Verify likes
SELECT
  pl.id,
  pl.post_id,
  pl.profile_id as liker_id,
  p.profile_id as post_owner_id,
  liker.handle as liker_handle
FROM post_likes pl
JOIN posts p ON p.id = pl.post_id
JOIN profiles liker ON liker.id = pl.profile_id
WHERE p.profile_id = 'YOUR_PROFILE_ID'
ORDER BY pl.created_at DESC;

-- Verify comments
SELECT
  c.id,
  c.post_id,
  c.profile_id as commenter_id,
  c.content,
  c.parent_comment_id,
  commenter.handle as commenter_handle,
  p.profile_id as post_owner_id
FROM post_comments c
JOIN posts p ON p.id = c.post_id
JOIN profiles commenter ON commenter.id = c.profile_id
WHERE p.profile_id = 'YOUR_PROFILE_ID'
   OR c.profile_id = 'YOUR_PROFILE_ID'
ORDER BY c.created_at DESC;
```

---

### 6) Search, Feed & Profile Aggregation

#### Search Test
1. From viewer_02 account, click search bar
2. Type: `test_golfer`
3. Verify test_golfer_01 appears in results
4. Also search by name: `Test Golfer`

**Expected:**
- ✅ Profile appears in both handle and name searches
- ✅ Avatar, name, and handle display correctly

#### Feed Test
1. From test_golfer_01 account, view your **Feed**
2. Verify all 3 posts appear in chronological order (newest first)
3. Verify like counts and comment counts are correct

**Expected:**
- ✅ All 3 posts visible
- ✅ Counts match actual likes/comments
- ✅ Media displays correctly

#### Profile Aggregation Test
1. Navigate to your **Profile Page**
2. Check **All Media** tab - should show Post 1 (photo) and Post 2 (golf round)
3. Check **Media with Stats** tab - should show only Post 2 (golf round)
4. Verify follower count = 1 (viewer_02)

**Expected:**
- ✅ Media tabs show correct posts
- ✅ Stats display correctly (course, score)
- ✅ Follower count accurate

---

### 7) Privacy Toggle (Smoke Test)

#### Test Privacy Restrictions

**Setup:**
1. From test_golfer_01, go to Settings → Privacy
2. Toggle profile to **Private**
3. Log out

**Test as Non-Follower (Unauthenticated):**
1. Open a new incognito window (not logged in)
2. Navigate to test_golfer_01's profile URL directly
3. Verify you see "Private Profile" message
4. Verify posts are hidden

**Test as Non-Follower (Different User):**
1. Create a third test user: `viewer_03@example.com`
2. Search for test_golfer_01
3. Verify you see "Private Profile" message
4. Try to follow - should show "Requested"

**Test as Existing Follower (viewer_02):**
1. Log in as viewer_02
2. Navigate to test_golfer_01's profile
3. Verify you CAN see posts and media (already following)

**Expected:**
- ✅ Private profile restricts content from non-followers
- ✅ Existing followers retain access
- ✅ New follow requests require approval

---

## C) Data Association Verification

### Run Comprehensive SQL Verification

1. Open **Supabase Dashboard → SQL Editor**
2. Open the file: `end-to-end-verification.sql`
3. Find line 9: `\set test_profile_id 'YOUR_PROFILE_ID_HERE'`
4. Replace with your actual UUID
5. Run the entire script

**What It Checks:**
- ✅ Profile exists with correct data
- ✅ Sport settings linked to profile
- ✅ All 3 posts have correct profile_id
- ✅ Media linked to posts correctly
- ✅ Golf round linked to post and profile
- ✅ Follow relationship has correct IDs and status
- ✅ Likes linked to posts and profiles
- ✅ Comments linked to posts and profiles
- ✅ Notifications linked to recipient and actor
- ✅ No orphaned records (foreign key integrity)

### Review Output

Look for these indicators:
- **✅** Green checkmarks = Pass
- **⛔** Red X = Fail (investigate)
- **⚠️** Warning = Edge case (may be okay)

---

## D) Edge Cases (Quick Pass)

### Edge Case 1: Minimal Data Post
1. Create a golf round post with minimal data:
   - Course: "Local Course"
   - Date: Today
   - Holes: 9 (only fill in 9 holes)
   - **Don't fill in weather, temperature, etc.**
2. Post it

**Expected:**
- ✅ Post creates successfully
- ✅ Stats display shows "9 holes" and score
- ✅ Missing fields show as "—" or default values

### Edge Case 2: Media-Only Post
1. Create a post with just photos, no caption
2. Upload 2-3 images
3. Don't add any text or hashtags
4. Post it

**Expected:**
- ✅ Post appears in feed
- ✅ All images display in carousel
- ✅ Caption area is empty (no "undefined" or error text)

### Edge Case 3: Private Profile Follow Cycle
1. Set profile to Private
2. Have viewer_02 send follow request
3. Accept the request
4. Verify viewer_02 now sees content
5. Unfollow viewer_02
6. Verify they lose access

**Expected:**
- ✅ Accept changes status from 'pending' to 'accepted'
- ✅ Content becomes visible after accept
- ✅ Unfollow removes access immediately
- ✅ Follow counts update correctly

---

## E) Success Criteria (Pass/Fail Checklist)

### Core Functionality
- [ ] Profile created successfully with correct user_id
- [ ] Profile edits persist (name, avatar, bio)
- [ ] Sport settings save and retrieve correctly
- [ ] All 3 post types create successfully
- [ ] Posts have correct profile_id as owner
- [ ] Media uploads link to correct post_id
- [ ] Golf round links to correct profile_id and post_id
- [ ] Follow creates correct relationship (follower_id → following_id)
- [ ] Follow status reflects privacy settings (pending vs accepted)
- [ ] Likes link to correct post_id and profile_id (liker)
- [ ] Comments link to correct post_id and profile_id (commenter)
- [ ] Notifications link to correct recipient_id and actor_id

### Data Integrity
- [ ] No orphaned posts (all have valid profile)
- [ ] No orphaned media (all have valid post)
- [ ] No orphaned golf holes (all have valid round)
- [ ] No orphaned notifications (all have valid actor)
- [ ] Foreign key relationships intact
- [ ] Counts match actual records (likes_count, comments_count)

### UI/UX
- [ ] Search finds profile by handle and name
- [ ] Feed displays all posts in correct order
- [ ] Profile media tabs show correct content
- [ ] Notifications appear in real-time or on refresh
- [ ] Privacy behavior matches expectations

### Privacy
- [ ] Public profile visible to all
- [ ] Private profile restricted to followers
- [ ] Follow requests require approval for private profiles
- [ ] Content hidden from non-followers on private profiles

---

## F) Reporting Format

After completing all tests, report back using this template:

```
═══════════════════════════════════════════════════
END-TO-END VERIFICATION REPORT
═══════════════════════════════════════════════════

Test User: test_golfer_01@example.com
Profile ID: [UUID]
Handle: @test_golfer_01
Test Date: [Date/Time]

─────────────────────────────────────────────────────
A) PROFILE
─────────────────────────────────────────────────────
Profile created: ✅ / ⛔
Profile ID matches auth ID: ✅ / ⛔
Edits persisted: ✅ / ⛔
Sport settings saved: ✅ / ⛔

─────────────────────────────────────────────────────
B) POSTS
─────────────────────────────────────────────────────
Posts created: 3 / [actual count]
All posts have correct profile_id: ✅ / ⛔
Text+Media post: ✅ / ⛔
Stats-only post: ✅ / ⛔
Text-only post: ✅ / ⛔

─────────────────────────────────────────────────────
C) MEDIA
─────────────────────────────────────────────────────
Media files uploaded: [count]
Media linked to correct posts: ✅ / ⛔
All media have correct owner: ✅ / ⛔

─────────────────────────────────────────────────────
D) GOLF ROUNDS
─────────────────────────────────────────────────────
Golf round created: ✅ / ⛔
Round linked to profile: ✅ / ⛔
Round linked to post: ✅ / ⛔
Hole-by-hole data saved: ✅ / ⛔

─────────────────────────────────────────────────────
E) FOLLOWS
─────────────────────────────────────────────────────
Follow relationship created: ✅ / ⛔
Correct direction (follower → following): ✅ / ⛔
Status correct (pending/accepted): ✅ / ⛔
Follow notification sent: ✅ / ⛔

─────────────────────────────────────────────────────
F) LIKES & COMMENTS
─────────────────────────────────────────────────────
Likes received: [count] (expected: 3)
Likes linked correctly: ✅ / ⛔
Comments received: [count] (expected: 3)
Comments linked correctly: ✅ / ⛔
Reply threaded correctly: ✅ / ⛔

─────────────────────────────────────────────────────
G) NOTIFICATIONS
─────────────────────────────────────────────────────
Total notifications: [count]
Follow notification: ✅ / ⛔
Like notifications: ✅ / ⛔ (count: [#])
Comment notifications: ✅ / ⛔ (count: [#])
All have correct recipient_id: ✅ / ⛔
All have correct actor_id: ✅ / ⛔

─────────────────────────────────────────────────────
H) SEARCH & FEED
─────────────────────────────────────────────────────
Profile appears in search: ✅ / ⛔
Posts appear in feed: ✅ / ⛔
Media tabs show correct content: ✅ / ⛔
Counts accurate: ✅ / ⛔

─────────────────────────────────────────────────────
I) PRIVACY
─────────────────────────────────────────────────────
Public profile visible: ✅ / ⛔
Private profile restricted: ✅ / ⛔
Follow requests work: ✅ / ⛔
Followers retain access: ✅ / ⛔

─────────────────────────────────────────────────────
J) DATA INTEGRITY (SQL Verification)
─────────────────────────────────────────────────────
No orphaned posts: ✅ / ⛔
No orphaned media: ✅ / ⛔
No orphaned golf holes: ✅ / ⛔
No orphaned notifications: ✅ / ⛔
Foreign keys intact: ✅ / ⛔

─────────────────────────────────────────────────────
BUGS / ANOMALIES
─────────────────────────────────────────────────────
[List any issues found with repro steps]

1. [Bug Description]
   - Steps to reproduce:
   - Expected behavior:
   - Actual behavior:
   - Screenshot/logs:

─────────────────────────────────────────────────────
OVERALL STATUS
─────────────────────────────────────────────────────
✅ PASS - All checks passed
⛔ FAIL - Critical issues found
⚠️  PARTIAL - Minor issues, non-blocking

═══════════════════════════════════════════════════
```

---

## G) Safety Notes

1. **Perform all tests in development/staging** - NOT production
2. **Use test email addresses** - Don't use real user accounts
3. **Clean up test data** after verification:
   ```sql
   -- Delete test profiles and cascading data
   DELETE FROM profiles WHERE email LIKE 'test_%@example.com';
   DELETE FROM profiles WHERE email LIKE 'viewer_%@example.com';
   ```
4. **Document all issues** before attempting fixes
5. **Never hot-fix in production** - Create tickets and test patches
6. **Take screenshots** of any errors or unexpected behavior

---

## H) Quick Reference: Common SQL Queries

### Check Profile Exists
```sql
SELECT id, email, handle, first_name, last_name, visibility
FROM profiles
WHERE email = 'test_golfer_01@example.com';
```

### Check All Posts for Profile
```sql
SELECT id, caption, sport_key, profile_id, created_at
FROM posts
WHERE profile_id = 'YOUR_PROFILE_ID'
ORDER BY created_at DESC;
```

### Check Follow Relationships
```sql
SELECT
  f.*,
  follower.handle as follower_handle,
  following.handle as following_handle
FROM follows f
JOIN profiles follower ON follower.id = f.follower_id
JOIN profiles following ON following.id = f.following_id
WHERE f.follower_id = 'YOUR_PROFILE_ID'
   OR f.following_id = 'YOUR_PROFILE_ID';
```

### Check Notifications
```sql
SELECT
  n.*,
  actor.handle as actor_handle,
  recipient.handle as recipient_handle
FROM notifications n
JOIN profiles actor ON actor.id = n.actor_id
JOIN profiles recipient ON recipient.id = n.recipient_id
WHERE n.recipient_id = 'YOUR_PROFILE_ID'
ORDER BY n.created_at DESC;
```

### Full Profile Summary
```sql
SELECT
  (SELECT COUNT(*) FROM posts WHERE profile_id = 'YOUR_PROFILE_ID') as total_posts,
  (SELECT COUNT(*) FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE p.profile_id = 'YOUR_PROFILE_ID') as total_media,
  (SELECT COUNT(*) FROM golf_rounds WHERE profile_id = 'YOUR_PROFILE_ID') as golf_rounds,
  (SELECT COUNT(*) FROM follows WHERE following_id = 'YOUR_PROFILE_ID' AND status = 'accepted') as followers,
  (SELECT COUNT(*) FROM follows WHERE follower_id = 'YOUR_PROFILE_ID' AND status = 'accepted') as following,
  (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id = pl.post_id WHERE p.profile_id = 'YOUR_PROFILE_ID') as likes_received,
  (SELECT COUNT(*) FROM notifications WHERE recipient_id = 'YOUR_PROFILE_ID') as notifications;
```

---

## I) Troubleshooting Common Issues

### Issue: "Profile not found" after signup
**Cause:** Database trigger may have failed or profile insert didn't complete
**Fix:** Check `end-to-end-verification.sql` section A to verify profile exists

### Issue: Posts not showing in feed
**Cause:** Privacy settings or RLS policies may be blocking
**Fix:** Verify profile visibility and post visibility are both public for initial testing

### Issue: Media not linking to posts
**Cause:** post_id foreign key mismatch
**Fix:** Run media verification query from section D

### Issue: Notifications not appearing
**Cause:** Triggers may not be firing or recipient_id incorrect
**Fix:** Check notification_preferences and run notification verification query

### Issue: Follow counts incorrect
**Cause:** Status filtering - only 'accepted' follows count
**Fix:** Verify follow status is 'accepted', not 'pending'

---

**END OF GUIDE**

For questions or issues, refer to:
- `end-to-end-verification.sql` for database checks
- `CLAUDE.md` for architecture documentation
- Supabase logs for error details
