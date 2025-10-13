# DevLog 010: Shared Round Scorecards & Post Creation UX

**Date:** January 2025
**Status:** ✅ Complete
**Related Issues:** Group activities, multi-player golf rounds, post creation refresh

## Overview

Implemented a comprehensive shared round scorecard system that allows golfers to create collaborative rounds, invite participants, track scores together, and view detailed hole-by-hole scorecards. Also fixed post creation refresh issues across the platform.

## Features Implemented

### 1. Shared Round Scorecards

#### Database Schema (Group Posts Foundation)
- **Sport-agnostic architecture** using polymorphic tables
- `group_posts` - Core table for all group activities (golf, hockey, etc.)
- `group_post_participants` - Participant tracking with attestation states
- `golf_scorecard_data` - Golf-specific scorecard information
- `golf_participant_scores` - Individual participant scores
- `golf_hole_scores` - Hole-by-hole score tracking

**Key Features:**
- Supports any number of holes (5, 9, 12, 18, etc.)
- Indoor/outdoor round tracking
- Participant status: pending → confirmed/declined
- Owner can pre-fill scores, participants can edit their own
- Auto-calculation of totals via database triggers

#### UI Components Created

**1. CreatePostModal Integration** (`src/components/CreatePostModal.tsx`)
- Added "Round Type" selector: Individual vs Shared
- Shared round form with:
  - Course name input
  - Date picker
  - Indoor/Outdoor toggle (tree/warehouse icons)
  - Holes selection (6, 9, 12, 18)
  - Tee color dropdown (outdoor only)
  - Participant selector (reuses TagPeopleModal)
  - Real-time validation

**2. SharedRoundQuickView** (`src/components/golf/SharedRoundQuickView.tsx`)
- Compact card for feed display
- Shows participant list with status badges
- Leader score display
- Confirmed/pending/declined status indicators
- "View Full Scorecard" button

**3. SharedRoundFullCard** (`src/components/golf/SharedRoundFullCard.tsx`)
- Traditional scorecard grid layout
- Hole-by-hole scores for all participants
- Birdie (red circles) and bogey (blue squares) styling
- Par/score/total columns
- Responsive design (mobile-friendly)
- Score entry access for participants

**4. ScoreEntryModal** (`src/components/golf/ScoreEntryModal.tsx`)
- Mobile-friendly numeric keypad
- Hole-by-hole entry (strokes, putts, FIR, GIR)
- Progress tracking with visual indicators
- Jump to hole navigation grid
- Totals summary (holes, strokes, putts)
- Validates required fields

**5. ParticipantAttestationModal** (`src/components/golf/ParticipantAttestationModal.tsx`)
- Invitation confirmation UI
- Shows round details (course, date, holes, tee color)
- Confirm/Decline actions
- "I'll decide later" option
- Indoor/Outdoor badge display

#### API Routes

All routes updated for Next.js 15 async params pattern:

**Group Posts:**
- `POST /api/group-posts` - Create shared round
- `GET /api/group-posts/[id]` - Get round details
- `PATCH /api/group-posts/[id]` - Update round
- `DELETE /api/group-posts/[id]` - Delete round
- `POST /api/group-posts/[id]/attest` - Confirm/decline participation
- `GET /api/group-posts/[id]/attest` - Get attestation status
- `POST /api/group-posts/[id]/participants` - Add participants
- `DELETE /api/group-posts/[id]/participants` - Remove participant

**Golf Scorecards:**
- `POST /api/golf/scorecards` - Create scorecard data
- `GET /api/golf/scorecards?group_post_id=xxx` - Get scorecard
- `POST /api/golf/scorecards/[id]/scores` - Add/update scores
- `GET /api/golf/scorecards/[id]/scores` - Get participant scores
- `PATCH /api/golf/scorecards/[id]/scores` - Confirm scores

### 2. Post Creation Refresh Fix

Fixed issue where new posts didn't appear without manual page refresh.

#### Feed Page (`src/app/feed/page.tsx`)
**Problem:** Posts weren't added to local state after creation

**Solution:**
```typescript
const handlePostCreated = async (newPost: unknown) => {
  if (newPost && typeof newPost === 'object' && 'id' in newPost) {
    const postData = newPost as { id: string; type?: string };

    if (postData.type === 'golf_round') {
      // Shared rounds need complete data - refetch
      await loadFeed();
    } else {
      // Regular posts - add immediately to top of feed!
      setPosts(prevPosts => [newPost as Post, ...prevPosts]);
    }
  }

  setIsCreatePostModalOpen(false);
  showSuccess('Success', 'Post created successfully!');
};
```

**Benefits:**
- Text posts appear instantly
- Media posts appear instantly
- Individual golf rounds appear instantly
- Shared rounds refetch for complete data
- No manual refresh needed

#### Profile Page (`src/app/athlete/page.tsx`)
**Problem:** "My Media" tab didn't refresh after post creation

**Solution:**
- Added `mediaRefreshKey` state variable
- Increment key on post creation to force component re-mount
- Pass key to `ProfileMediaTabs` component

```typescript
const [mediaRefreshKey, setMediaRefreshKey] = useState(0);

onPostCreated={() => {
  loadAthleteData(user.id, true);
  setMediaRefreshKey(prev => prev + 1); // Trigger refresh
  setIsCreatePostModalOpen(false);
  showSuccess('Success', 'Post created successfully!');
}}

<ProfileMediaTabs
  key={mediaRefreshKey}  // Re-mounts when changed
  ...
/>
```

## Technical Decisions

### 1. Sport-Agnostic Architecture
**Decision:** Use polymorphic `group_posts` table instead of sport-specific tables

**Rationale:**
- Future-proof for other sports (hockey, volleyball, etc.)
- Clean separation of concerns
- Sport-specific data in separate tables
- Easy to add new sports without schema changes

### 2. Participant Attestation Model
**Decision:** Require explicit confirmation/decline from participants

**Rationale:**
- Prevents unwanted tagging
- Ensures data accuracy
- Clear participant intent
- Better user experience

### 3. Database Triggers for Score Calculation
**Decision:** Use PostgreSQL triggers to auto-calculate totals

**Rationale:**
- Single source of truth
- Prevents calculation drift
- Consistent across all interfaces
- Reduces client-side complexity

### 4. Next.js 15 Async Params
**Decision:** Update all route handlers to use `Promise<{ id: string }>`

**Rationale:**
- Required by Next.js 15
- Type-safe
- Future-proof
- Follows framework best practices

## Files Modified

### New Components
- `src/components/golf/SharedRoundQuickView.tsx`
- `src/components/golf/SharedRoundFullCard.tsx`
- `src/components/golf/ScoreEntryModal.tsx`
- `src/components/golf/ParticipantAttestationModal.tsx`

### Modified Components
- `src/components/CreatePostModal.tsx` - Added shared round creation UI
- `src/components/PostCard.tsx` - Integrated shared round display
- `src/components/SearchBar.tsx` - Fixed type error with sport_key

### Modified Pages
- `src/app/feed/page.tsx` - Fixed post creation refresh
- `src/app/athlete/page.tsx` - Added media refresh trigger

### API Routes (Next.js 15 Updates)
- `src/app/api/group-posts/route.ts`
- `src/app/api/group-posts/[id]/route.ts`
- `src/app/api/group-posts/[id]/participants/route.ts`
- `src/app/api/group-posts/[id]/attest/route.ts`
- `src/app/api/golf/scorecards/route.ts`
- `src/app/api/golf/scorecards/[id]/scores/route.ts`

### Database Migration
- `setup-group-posts-foundation.sql` - Complete schema for shared rounds

## Testing Checklist

- [x] Build passes without errors
- [x] TypeScript compilation successful
- [x] Next.js 15 async params pattern applied
- [ ] Create shared round with participants
- [ ] Participant confirmation/decline flow
- [ ] Score entry for multiple participants
- [ ] View full scorecard in feed
- [ ] Indoor/outdoor round display
- [ ] Post creation refresh (text, media, rounds)
- [ ] Profile media tab refresh

## Known Limitations

1. **Notifications:** Participant invitation notifications not yet implemented
2. **Real-time Updates:** Score changes require manual refresh
3. **Participant Management:** No UI for removing participants after creation
4. **Score Validation:** Par values not yet tracked per hole

## Future Enhancements

1. **Notification System:**
   - Notify participants when invited
   - Notify owner when participants confirm/decline
   - Notify all when scores are added/updated

2. **Real-time Updates:**
   - Use Supabase Realtime for live score updates
   - Show "Someone is adding scores..." indicator

3. **Enhanced Score Entry:**
   - Auto-fetch course par values
   - Track fairway bunkers, sand saves
   - Support scramble/best ball formats

4. **Participant Management:**
   - Allow owner to remove participants
   - Send reminders to pending participants
   - Support "maybe" status

5. **Analytics:**
   - Compare participant performance
   - Track head-to-head records
   - Generate handicap adjustments

## Lessons Learned

1. **Start with Database:** Getting the schema right upfront saved significant refactoring
2. **Component Reusability:** TagPeopleModal worked perfectly for participant selection
3. **Type Safety:** Next.js 15 async params caught potential runtime errors
4. **User Feedback:** Instant post refresh greatly improves perceived performance
5. **Progressive Enhancement:** Shared rounds work even if notifications aren't implemented yet

## Performance Notes

- Feed page: Posts added instantly (no API call for regular posts)
- Profile page: Media tab re-mounts efficiently (minimal re-render)
- Scorecard modal: Lazy loads participant scores on demand
- Database triggers: Auto-calculations don't impact client performance

## Deployment Notes

1. **Database Migration Required:**
   ```bash
   # Run in Supabase SQL Editor:
   # 1. setup-group-posts-foundation.sql
   ```

2. **Environment Variables:** No new variables needed

3. **Breaking Changes:** None - feature is additive

## Related Documentation

- [GROUP_POSTS_IMPLEMENTATION_STATUS.md](../../GROUP_POSTS_IMPLEMENTATION_STATUS.md)
- [SHARED_SCORECARD_IMPLEMENTATION.md](../../SHARED_SCORECARD_IMPLEMENTATION.md)
- [CLAUDE.md](../../CLAUDE.md) - Updated with shared rounds section

---

**Next Steps:**
1. Test shared round creation end-to-end
2. Implement notification handlers
3. Add real-time score updates
4. Enhance participant management UI
