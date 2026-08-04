# QA Test Guide for Athlete Profile Page

## Overview
This guide provides detailed test scenarios for the athlete profile page to ensure all functionality works correctly across different data states.

## Test Environment Setup

### Prerequisites
- Access to admin panel to create test users
- Ability to modify database directly (Supabase dashboard)
- Multiple browser tabs for testing different users
- Browser dev tools for monitoring API calls

## Test Cases

### 8.1 Empty State Test ✅

**Setup:**
1. Create a new user through admin panel
2. Do not add any profile data beyond email
3. Navigate to `/athlete` as this user

**Expected Results:**

| Section | Expected Display |
|---------|-----------------|
| **Header** | |
| Name | "Your Name" (placeholder) |
| Sport | "Your Sport" (placeholder) |
| School | "Your School" (placeholder) |
| Location | "City, State" (placeholder) |
| Avatar | Default placeholder image |
| Badges | None visible |
| **Season Highlights** | |
| Cards | Exactly 3 cards displayed |
| Values | All show "—" |
| Context | All show "—" |
| **Performances** | |
| Table | Header visible, "No performances yet" message |
| Add Button | Visible and clickable |
| **Tabs** | |
| Stats | All values show "—" |
| Academics | GPA/SAT/ACT show "—" |
| Socials | "No social links added" |
| Highlights | Empty state message |

**Pass Criteria:** All placeholders render without errors, layout remains stable

---

### 8.2 Partial Data Test ✅

**Setup:**
1. Update profile with ONLY:
   - `display_name`: "John Test"
   - `avatar_url`: Valid image URL
   - `sport`: "Track & Field"
2. Leave all other fields NULL

**Expected Results:**

| Field | Display |
|-------|---------|
| Name | "John Test" ✅ |
| Avatar | Custom image ✅ |
| Sport | "Track & Field" ✅ |
| School | "Your School" (placeholder) |
| Location | "City, State" (placeholder) |
| Coach | Empty or placeholder |
| Bio | "No bio yet" |

**Pass Criteria:** Real data displays correctly while missing fields show placeholders

---

### 8.3 Full Data Test ✅

**Setup:**
```sql
-- Add complete profile
UPDATE profiles SET
  display_name = 'John Test',
  avatar_url = 'https://example.com/avatar.jpg',
  sport = 'Track & Field',
  school = 'Test University',
  location = 'San Francisco, CA',
  coach = 'Coach Smith',
  bio = 'Elite sprinter with multiple records',
  graduation_year = 2025,
  gpa = 3.8,
  sat_score = 1450,
  act_score = 32
WHERE user_id = 'test-user-id';

-- Add vitals
INSERT INTO athlete_vitals (user_id, height_feet, height_inches, weight_display, weight_unit, ...)
VALUES ('test-user-id', 6, 2, 185, 'lbs', ...);

-- Add 3 badges
INSERT INTO athlete_badges (user_id, badge_type, display_order)
VALUES 
  ('test-user-id', 'all_american', 1),
  ('test-user-id', 'state_champion', 2),
  ('test-user-id', 'school_record', 3);

-- Add performances
INSERT INTO athlete_performances (user_id, event_name, result, place, date, location)
VALUES 
  ('test-user-id', '100m Sprint', '10.25s', 1, '2024-05-15', 'State Championships'),
  ('test-user-id', '200m Sprint', '20.89s', 2, '2024-05-15', 'State Championships');

-- Add highlights
INSERT INTO athlete_season_highlights (user_id, stat_name, stat_value, stat_context, display_order)
VALUES 
  ('test-user-id', '100m Best', '10.25s', 'State Record', 1),
  ('test-user-id', 'Championships', '5', 'Career Total', 2),
  ('test-user-id', 'Team Captain', '2 Years', 'Leadership', 3);
```

**Expected Results:**
- All profile fields display real values ✅
- Badges appear in header with correct icons and order ✅
- Season highlights show actual stats ✅
- Performance table populated with sortable data ✅
- All tabs display real data ✅

---

### 8.4 Edit Flows Test ✅

**Test Scenarios:**

#### A. Profile Edit
1. Click Edit Profile
2. Change bio to "Updated bio text"
3. Save → Refresh page
4. **Verify:** New bio persists ✅

#### B. Add Performance
1. Click "Add Performance" 
2. Enter:
   - Event: "400m Sprint"
   - Result: "47.5s"
   - Place: 3
   - Date: Today
   - Location: "Regional Meet"
3. Save
4. **Verify:** New row appears in table ✅

#### C. Delete Performance
1. Click delete on any performance
2. Confirm deletion
3. **Verify:** Row removed from table ✅

#### D. Reorder Badges
1. Open edit modal
2. Drag badges to new order
3. Save
4. **Verify:** New order reflects in header ✅

---

### 8.5 RLS Permission Test ✅

**Setup:**
1. Create User A and User B
2. Add data for both users
3. Log in as User A

**Test Cases:**

| Action | Expected Result |
|--------|----------------|
| View own profile | ✅ Success |
| API call for User B's profile | ❌ Returns empty/403 |
| Update own profile | ✅ Success |
| Update User B's profile | ❌ Fails silently |
| Add performance for self | ✅ Success |
| Add performance for User B | ❌ Blocked by RLS |

**Verification:**
```javascript
// In browser console as User A
const response = await fetch('/api/profile?userId=user-b-id');
const data = await response.json();
console.log(data); // Should be empty or error
```

---

## Edge Cases to Test

### Long Content
- Bio with 1000+ characters
- School name > 50 characters
- 50+ performances in table

### Special Characters
- Name: "O'Brien"
- Name: "José García"
- Bio with emojis: "🏃‍♂️ Fast runner! 🏆"

### Responsive Design
- Mobile: < 768px width
- Tablet: 768px - 1024px
- Desktop: > 1024px

### Performance Metrics
- Page load: < 2 seconds
- Smooth scrolling
- No layout shift

---

## Automated Test Commands

> **Note (August 2026):** the `scripts/*.mjs` QA helpers this section used to name
> were deleted — they were orphaned, nothing ran them, and one read a `.env` file
> this project does not use. Don't go looking for them. The checklist above is
> still walked by hand; the automated gate is now:

> **Smoke suite (added August 2026):** `npm run test:e2e` runs the Playwright
> smoke suite in `e2e/` — health, landing, real UI login, feed post round-trip,
> a 9-hole golf round through the composer, and messages/notifications renders.
> It needs the three Supabase vars (`.env.local` locally; repo secrets in CI's
> `smoke` job), creates a disposable private `edgeqa-*` user per run and always
> deletes it. Unlike the old orphaned scripts, this suite is wired into CI.

```bash
npm run verify       # typecheck + lint + test + build — run this before committing

# or the parts individually
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . --max-warnings 45
npm run test         # vitest run (node-only — no jsdom, so no DOM tests)
npm run build
```

## Test Status Legend
- ✅ Test Passed
- ❌ Test Failed  
- ⏳ Test Pending
- ⚠️ Needs Review

## Known Issues
- None currently identified

## Test Coverage Summary
- **UI Rendering:** 100% ✅
- **CRUD Operations:** 100% ✅
- **RLS Security:** 100% ✅
- **Edge Cases:** 90% ✅
- **Performance:** Not measured

---

Last Updated: January 2025
Test Version: 1.0.0