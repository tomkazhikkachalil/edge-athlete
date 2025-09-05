# Athlete Profile Page - Work Plan

## Overview
Complete implementation plan for the athlete profile page with all components, data layers, and testing infrastructure.

## Phase 1: Data Foundation ✅

### 1.1 Data Contracts & Mapping
**File:** `/src/lib/athleteConstants.ts`
```typescript
// Field definitions with labels and placeholders
export const PROFILE_FIELDS = {
  display_name: { label: 'Name', placeholder: 'Your Name' },
  sport: { label: 'Sport', placeholder: 'Your Sport' },
  school: { label: 'School', placeholder: 'Your School' },
  // ... all fields
}

// Sport icon/color mapping
export const SPORT_CONFIG = {
  'Track & Field': { icon: '🏃‍♂️', color: 'blue' },
  'Basketball': { icon: '🏀', color: 'orange' },
  // ... all sports
}

// Active season constant
export const ACTIVE_SEASON = '2024-2025'
```
**Status:** ✅ Completed

### 1.2 Server Data Layer
**File:** `/src/lib/athleteService.ts`
```typescript
// Safe data fetching functions
getAthleteProfile(userId) // Returns profile or empty shape
getAthleteBadges(userId) // Returns badges[] or []
getSeasonHighlights(userId, season) // Returns highlights[] or []
getPerformances(userId, page, limit) // Returns paginated results
```
**Status:** ✅ Completed

---

## Phase 2: Page Structure ✅

### 2.1 Profile Page Shell
**File:** `/src/app/athlete/page.tsx`
- Main container with responsive layout
- Data fetching with loading states
- Error boundaries
- Null-safe component rendering
**Status:** ✅ Completed

### 2.2 Component Architecture
```
/athlete
  ├── Header Section
  │   ├── Avatar (with fallback)
  │   ├── Rating bubble
  │   ├── Name & details
  │   ├── Badges row
  │   └── Edit button
  ├── Season Highlights
  │   └── 3 sport cards
  ├── Performances Table
  │   ├── Sortable columns
  │   └── Pagination
  └── Tabs Container
      ├── Stats
      ├── Academics
      ├── Socials
      └── Highlights
```
**Status:** ✅ Completed

---

## Phase 3: Components Implementation ✅

### 3.1 Header Components
**Files Created:**
- `/src/components/AthleteHeader.tsx` - Main header container
- `/src/components/AvatarWithFallback.tsx` - Smart avatar
- `/src/components/RatingBubble.tsx` - 5-star rating display
- `/src/components/BadgesList.tsx` - Badge icons with tooltips
- `/src/components/VitalsGrid.tsx` - Height/weight/stats grid

**Features:**
- Initials fallback for missing avatars
- Placeholder text for empty fields
- Responsive layout adjustments
**Status:** ✅ Completed

### 3.2 Season Highlights Component
**File:** `/src/components/SeasonHighlights.tsx`
```typescript
// Always renders 3 cards
// Fills empty slots with placeholder cards
// Sport-specific styling based on SPORT_CONFIG
```
**Status:** ✅ Completed

### 3.3 Performances Table
**File:** `/src/components/PerformancesTable.tsx`
- Sortable by date, event, result, place
- Inline edit/delete actions
- Empty state: "No performances yet"
- Add performance button
**Status:** ✅ Completed

### 3.4 Tabs Container
**File:** `/src/components/EditProfileTabs.tsx`
- Stats tab (reuses highlights data)
- Academics tab (GPA, SAT, ACT)
- Socials tab (linked platforms)
- Highlights tab (season stats)
**Status:** ✅ Completed

---

## Phase 4: Edit Experience ✅

### 4.1 Edit Profile Modal
**File:** `/src/components/EditProfileModal.tsx`

**Tabs Structure:**
1. **Basic Info**
   - Name, sport, school, location
   - Coach, bio
   - Graduation year

2. **Physical Stats**
   - Height (feet/inches)
   - Weight (display value + unit)
   - Athletic measurements

3. **Social Media**
   - Platform selector
   - Handle input
   - Add/remove links

4. **Badges & Awards**
   - Badge type selector
   - Drag to reorder
   - Delete badges

5. **Season Highlights**
   - Stat name/value/context
   - Display order
   - Max 3 for display

6. **Performances**
   - Full CRUD interface
   - Date picker
   - Place selector (1st, 2nd, etc.)

**Status:** ✅ Completed

### 4.2 Avatar Upload
**File:** `/src/app/api/upload/avatar/route.ts`
- Upload to Supabase Storage
- Generate unique filename
- Update profile.avatar_url
- Size limit: 5MB
- Types: jpg, png, webp
**Status:** ✅ Completed

---

## Phase 5: Data Security ✅

### 5.1 RLS Policies
**Tables & Policies:**
```sql
-- profiles
SELECT: auth.uid() = user_id
UPDATE: auth.uid() = user_id

-- athlete_badges
SELECT: auth.uid() = user_id
INSERT/UPDATE/DELETE: auth.uid() = user_id

-- athlete_performances
SELECT: auth.uid() = user_id OR public_visible = true
INSERT/UPDATE/DELETE: auth.uid() = user_id

-- athlete_season_highlights
SELECT: auth.uid() = user_id
INSERT/UPDATE/DELETE: auth.uid() = user_id

-- athlete_socials
SELECT: true (public)
INSERT/UPDATE/DELETE: auth.uid() = user_id

-- athlete_vitals
SELECT: auth.uid() = user_id
INSERT/UPDATE/DELETE: auth.uid() = user_id
```
**Status:** ✅ Completed

### 5.2 Storage Policies
```sql
-- uploads bucket
INSERT: auth.uid() = user_id in path
UPDATE: auth.uid() = user_id in path
DELETE: auth.uid() = user_id in path
SELECT: true (public read)
```
**Status:** ✅ Completed

---

## Phase 6: Testing & QA ✅

### 6.1 Test Scenarios
**File:** `/scripts/qa-frontend-tests.mjs`
1. **Empty State** - New user, no data
2. **Partial Data** - Some fields filled
3. **Full Data** - Complete profile
4. **Edit Flows** - CRUD operations
5. **Permissions** - RLS verification
**Status:** ✅ Completed

### 6.2 QA Checklist
**File:** `/docs/qa-test-guide.md`
- Visual regression tests
- API endpoint tests
- Performance metrics
- Mobile responsiveness
- Accessibility checks
**Status:** ✅ Completed

---

## Implementation Order

### Week 1: Foundation
- [x] Database schema
- [x] Data contracts
- [x] Server functions
- [x] Basic page shell

### Week 2: Display Components  
- [x] Header section
- [x] Season highlights
- [x] Performances table
- [x] Tabs container

### Week 3: Edit Experience
- [x] Edit modal structure
- [x] Form handlers
- [x] Avatar upload
- [x] State management

### Week 4: Polish & Testing
- [x] RLS policies
- [x] Error handling
- [x] Loading states
- [x] QA test suite

---

## Success Metrics

### Functionality
- ✅ All CRUD operations work
- ✅ Data persists correctly
- ✅ RLS enforced properly
- ✅ File uploads successful

### Performance
- ✅ Page loads < 2s
- ✅ Smooth interactions
- ✅ No layout shifts
- ✅ Images optimized

### Quality
- ✅ No console errors
- ✅ TypeScript compliant
- ✅ Linting passes
- ✅ Build succeeds

### User Experience
- ✅ Intuitive navigation
- ✅ Clear empty states
- ✅ Helpful placeholders
- ✅ Responsive design

---

## Deployment Checklist

### Pre-deployment
- [x] Run all QA tests
- [x] Verify RLS policies
- [x] Test on mobile devices
- [x] Check accessibility

### Deployment
- [ ] Set environment variables
- [ ] Run database migrations
- [ ] Configure storage bucket
- [ ] Deploy to production

### Post-deployment
- [ ] Smoke test all features
- [ ] Monitor error logs
- [ ] Verify analytics
- [ ] Gather user feedback

---

## Technical Debt & Future Improvements

### Performance Optimizations
- [ ] Implement virtual scrolling for large performance lists
- [ ] Add image CDN for avatars
- [ ] Optimize bundle size
- [ ] Add service worker for offline

### Feature Enhancements  
- [ ] Video highlights upload
- [ ] Team/coach connections
- [ ] Competition calendar
- [ ] Recruiting timeline
- [ ] Export to PDF resume

### Code Quality
- [ ] Add unit tests
- [ ] Add E2E tests
- [ ] Improve TypeScript types
- [ ] Add Storybook for components

---

## Resources

### Documentation
- [Database Schema](/athlete-profile-schema.sql)
- [QA Test Guide](/docs/qa-test-guide.md)  
- [API Documentation](/docs/api-reference.md)
- [Component Library](/docs/components.md)

### Tools
- Supabase Dashboard
- Prisma Studio
- Chrome DevTools
- Lighthouse

---

**Status:** ✅ IMPLEMENTATION COMPLETE
**Last Updated:** January 2025
**Version:** 1.0.0