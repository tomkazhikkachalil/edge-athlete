# Testing Expandable Stats - Complete Guide

## Overview

This guide covers testing procedures for posts with detailed stats/metrics. All detailed stats should be expandable using the `<details>` HTML element pattern.

## Current Implementation Status

### ✅ Implemented Sports

**Golf** - Complete with hole-by-hole scorecard
- Summary: Score, putts, FIR%, GIR%, weather, conditions
- Expandable: Traditional scorecard with front 9, back 9, hole-by-hole details
- Tables: `golf_rounds` (summary) → `golf_holes` (detailed breakdown)
- Components: PostCard.tsx (lines 504-866), PostDetailModal.tsx (lines 94-122)

### 🚧 Registered But Not Implemented

- Ice Hockey
- Volleyball
- Basketball (documentation example ready)
- Soccer
- Baseball

## Testing Checklist

### 1. Data Loading Tests

Test that detailed stats are fetched correctly:

#### Feed View Test
```bash
# Navigate to feed
# Find a post with golf stats
# Open browser console
# Verify golf_round data is loaded
```

**Expected:**
- Post object has `golf_round` property
- `golf_round` has `golf_holes` array
- Holes are sorted 1-18

**Commands:**
```javascript
// In browser console, inspect post data
console.log(post.golf_round);
console.log(post.golf_round.golf_holes);
```

#### Modal View Test
```bash
# Navigate to profile page (own or other user's)
# Click on media thumbnail in profile media tabs
# Modal opens with post detail
# Check console for data loading logs
```

**Expected Console Logs:**
```
[PostDetailModal] Fetching post: <post-id>
[PostDetailModal] Raw data received: {...}
[PostDetailModal] Loaded golf round with holes: {...}
[PostDetailModal] Transformed data for PostCard: {...}
```

**Verify:**
- `golf_round` is present in transformed post
- `golf_holes` array is populated
- Holes are sorted by hole_number

### 2. Display Tests

#### Summary Stats (Always Visible)

**Location:** PostCard.tsx lines 504-596

**Test Steps:**
1. Find post with golf round
2. Verify summary section displays WITHOUT expanding

**Expected Display:**
- ✅ Course name with golf ball icon
- ✅ Date, tee color, number of holes
- ✅ Large score badge (gross score + to par)
- ✅ Inline stats bar (putts, FIR%, GIR%)
- ✅ Weather/conditions (if available)
- ✅ Course/slope rating (if available)

**Visual Verification:**
- Green gradient background (from-green-50 to-green-100)
- White score badge with large font
- Red/blue color for over/under par

#### Expandable Details (Click to View)

**Location:** PostCard.tsx lines 597-864

**Test Steps:**
1. Find post with golf round
2. Click on "View Scorecard (18 holes)" text
3. Scorecard expands

**Expected Display:**
- ✅ Expandable section is initially collapsed
- ✅ Chevron icon rotates when expanded
- ✅ Traditional scorecard layout displays
- ✅ Front 9 table (holes 1-9)
- ✅ Back 9 table (holes 10-18)
- ✅ Score indicators (eagles, birdies, bogeys, doubles)
- ✅ Putts row below each nine
- ✅ Legend showing score indicators
- ✅ Total score at bottom

**Score Indicator Verification:**
- Eagle (-2): Double blue ring `ring-2 ring-blue-500`
- Birdie (-1): Single blue ring `ring-1 ring-blue-400`
- Par (0): No border, black text
- Bogey (+1): Red border `border border-red-400`
- Double+ (+2): Double red ring `ring-2 ring-red-500`

### 3. Feed vs Modal Comparison

**Critical Test:** Expandable sections must work identically in both views

#### Test Procedure

**Part A: Feed View**
1. Navigate to `/feed`
2. Find post with golf stats
3. Expand scorecard by clicking "View Scorecard"
4. Verify scorecard displays completely
5. Click through holes, verify all data visible
6. Close expansion (click again)

**Part B: Modal View**
1. Navigate to `/athlete` (own profile) or `/athlete/[id]` (other's profile)
2. Click media thumbnail with golf stats
3. Modal opens
4. Expand scorecard by clicking "View Scorecard"
5. Verify scorecard displays identically to feed
6. All data should match feed view
7. Navigation (prev/next) preserves expansion state

**Expected Result:**
✅ Scorecard works identically in feed and modal
✅ No missing data in modal
✅ Same visual styling
✅ Same interaction behavior

### 4. Edge Cases

#### Empty Data
```sql
-- Test with round but no holes
INSERT INTO golf_rounds (...) VALUES (...); -- round_id: abc123
-- Don't insert any golf_holes
```

**Expected:**
- Summary stats show correctly
- No "View Scorecard" link appears
- No expansion section rendered

#### Partial Data
```sql
-- Test with only 9 holes (front nine)
INSERT INTO golf_holes (round_id, hole_number, ...) VALUES
('abc123', 1, ...), ('abc123', 2, ...), ..., ('abc123', 9, ...);
```

**Expected:**
- Front 9 table displays
- Back 9 table does not display
- OUT total shows correctly

#### Missing Summary Stats
```sql
-- Test with round but null stats
UPDATE golf_rounds SET
  total_putts = NULL,
  fir_percentage = NULL,
  gir_percentage = NULL
WHERE id = 'abc123';
```

**Expected:**
- Stats bar does not display (hidden)
- Score still shows
- Scorecard still expandable

### 5. Responsive Design Tests

#### Desktop (≥1024px)
- Full scorecard table visible
- All columns display
- Good spacing

#### Tablet (768px - 1023px)
- Scorecard slightly compressed
- All data still visible
- Horizontal scroll if needed

#### Mobile (≤767px)
- Scorecard scrolls horizontally
- Summary stats stack vertically
- Touch-friendly expansion

**Test Commands:**
```bash
# Open Chrome DevTools
# Toggle device toolbar (Cmd+Shift+M / Ctrl+Shift+M)
# Test each breakpoint:
# - iPhone SE (375px)
# - iPad (768px)
# - Desktop (1440px)
```

### 6. Keyboard Accessibility

**Test Steps:**
1. Tab to expandable section
2. Press Enter or Space
3. Scorecard expands
4. Tab through scorecard
5. Press Enter/Space again
6. Scorecard collapses

**Expected:**
- ✅ `<details>` is keyboard accessible
- ✅ Enter/Space toggles expansion
- ✅ Focus visible on summary
- ✅ Content navigable with Tab

### 7. Performance Tests

#### Large Dataset
```sql
-- Test with 18 holes full of data
INSERT INTO golf_holes (round_id, hole_number, par, distance_yards, strokes, putts, fairway_hit, green_in_regulation, notes)
VALUES
('abc123', 1, 4, 375, 5, 2, true, false, 'Hit it left into trees'),
('abc123', 2, 3, 165, 3, 2, NULL, true, 'Good tee shot'),
-- ... all 18 holes with full data
```

**Expected:**
- Initial load: <100ms
- Expansion: <50ms
- No lag or flickering
- Smooth chevron rotation

#### Multiple Posts
- Feed with 10+ golf posts
- Each expandable independently
- No memory leaks
- Smooth scrolling

### 8. Browser Compatibility

Test in multiple browsers:

#### Chrome/Edge (Chromium)
- ✅ Full support
- ✅ Smooth animations

#### Firefox
- ✅ Full support
- ✅ Slightly different chevron rotation

#### Safari
- ✅ Full support
- ⚠️ Check gradient backgrounds
- ⚠️ Check ring borders on scores

#### Mobile Browsers
- Safari iOS
- Chrome Android
- Samsung Internet

### 9. SQL Query Verification

**Test Query:**
```sql
-- Verify data structure
SELECT
  p.id,
  p.caption,
  p.sport_key,
  r.id as round_id,
  r.course,
  r.gross_score,
  COUNT(h.id) as hole_count
FROM posts p
LEFT JOIN golf_rounds r ON p.round_id = r.id
LEFT JOIN golf_holes h ON h.round_id = r.id
WHERE p.sport_key = 'golf'
GROUP BY p.id, r.id
ORDER BY p.created_at DESC
LIMIT 5;
```

**Expected:**
- Posts with `round_id` show in results
- `hole_count` shows 9 or 18 (or 0)
- All foreign keys valid

### 10. PostDetailModal Specific Tests

#### Data Transformation
Check console logs for proper transformation:

```javascript
// Expected console output
[PostDetailModal] Raw data received: {
  id: "...",
  round_id: "...",
  profiles: { ... },
  post_media: [ ... ]
}
[PostDetailModal] Loaded golf round with holes: {
  id: "...",
  course: "Pebble Beach",
  golf_holes: [ ... ] // sorted by hole_number
}
[PostDetailModal] Transformed data for PostCard: {
  id: "...",
  profile: { ... }, // renamed from profiles
  media: [ ... ],    // renamed from post_media
  golf_round: { ... } // attached
}
```

#### Error Handling
Test error scenarios:

**Missing round_id:**
```javascript
// Post has round_id but round doesn't exist
// Expected: No golf_round in transformed post
// Expected: No error, just no stats display
```

**Database Query Fails:**
```javascript
// Simulate query failure
// Expected: Error logged to console
// Expected: Modal shows post without stats
// Expected: No crash or infinite loading
```

## Regression Testing

After adding new sports, run all golf tests again to ensure:
- ✅ Golf still works in feed
- ✅ Golf still works in modal
- ✅ No conflicts between sports
- ✅ Multiple sports on same page work

## Automated Test Ideas

### Unit Tests (Future)
```typescript
describe('PostCard Golf Stats', () => {
  it('renders summary stats without expansion', () => {
    // Test summary display
  });

  it('expands scorecard when clicked', () => {
    // Test expansion
  });

  it('displays score indicators correctly', () => {
    // Test eagle/birdie/bogey colors
  });
});

describe('PostDetailModal', () => {
  it('fetches golf round with holes', async () => {
    // Test data fetching
  });

  it('transforms data correctly', () => {
    // Test field renaming
  });
});
```

### E2E Tests (Future)
```typescript
describe('Golf Stats E2E', () => {
  it('expands scorecard in feed', () => {
    cy.visit('/feed');
    cy.contains('View Scorecard').click();
    cy.get('table').should('be.visible');
  });

  it('expands scorecard in modal', () => {
    cy.visit('/athlete');
    cy.get('[data-testid="media-grid-item"]').first().click();
    cy.get('[data-testid="post-modal"]').should('be.visible');
    cy.contains('View Scorecard').click();
    cy.get('table').should('be.visible');
  });
});
```

## Common Issues

### Issue: Scorecard not expanding in modal

**Symptoms:**
- Works in feed
- Doesn't work in modal
- `<details>` element present but no data

**Cause:**
Missing `golf_holes` in PostDetailModal data fetch

**Fix:**
```typescript
// Ensure PostDetailModal fetches holes
const { data: roundData } = await supabase
  .from('golf_rounds')
  .select(`
    *,
    golf_holes (*)  // ← MUST include this
  `)
  .eq('id', data.round_id)
  .single();
```

### Issue: Holes displayed out of order

**Cause:**
Missing sort operation

**Fix:**
```typescript
if (roundData && roundData.golf_holes) {
  roundData.golf_holes.sort((a, b) => a.hole_number - b.hole_number);
}
```

### Issue: Duplicate stats display

**Cause:**
Both `golf_round` and legacy `stats_data` present

**Solution:**
Golf round display takes precedence over stats_data (correct behavior)

## New Sport Checklist

When adding a new sport with expandable stats:

1. [ ] Create database tables ({sport}_games, {sport}_periods)
2. [ ] Add data loading to PostDetailModal.tsx
3. [ ] Add display to PostCard.tsx with `<details>`
4. [ ] Test summary stats visible without expansion
5. [ ] Test detailed stats expand on click
6. [ ] **Test in feed view**
7. [ ] **Test in modal view** (critical!)
8. [ ] Test with 0 periods (empty state)
9. [ ] Test with partial data
10. [ ] Test on mobile/tablet/desktop
11. [ ] Test keyboard accessibility
12. [ ] Verify sorting of periods
13. [ ] Add to ADDING_SPORTS_WITH_STATS.md

## Support

If tests fail:
1. Check browser console for errors
2. Verify database data exists
3. Check PostDetailModal console logs
4. Compare with golf implementation
5. Review ADDING_SPORTS_WITH_STATS.md

## Version

- **Version**: 1.0.0
- **Last Updated**: 2025-01
- **Status**: ✅ Production Ready
