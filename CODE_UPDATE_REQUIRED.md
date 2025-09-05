# ⚠️ IMPORTANT: Code Updates Required After Schema Setup

After running the working schema (`supabase-athlete-schema-working.sql`), you need to update your API code to use `profile_id` instead of `user_id` in the athlete tables.

## 🔍 Issue Identified

**Database Schema:** Athlete tables use `profile_id UUID` (references `profiles.id`)  
**Current API Code:** Uses `user_id` in queries

This mismatch will cause queries to fail after the schema is applied.

## 🛠️ Required Code Changes

### 1. Update `src/lib/athleteService.ts`

**Find and replace all instances:**
- `user_id` → `profile_id` in database queries
- `eq('user_id', ...)` → `eq('profile_id', ...)`

**Example changes needed:**
```typescript
// OLD:
.eq('user_id', profileId)

// NEW: 
.eq('profile_id', profileId)
```

### 2. Update TypeScript Interfaces in `src/lib/supabase.ts`

**Current interfaces use `profile_id` ✅** - These are already correct:
```typescript
export interface AthleteBadge {
  profile_id: string; // ✅ Already correct
}
```

### 3. Update API Routes

Check these files for `user_id` usage:
- `src/app/api/season-highlights/route.ts`
- Any other athlete-related API endpoints

### 4. Update Frontend Components

Check these files for `user_id` in database operations:
- `src/components/EditProfileModal.tsx` 
- `src/components/SeasonHighlights.tsx`
- `src/app/athlete/page.tsx`

## 📝 Search and Replace Guide

**Safe approach:**
1. Search codebase for: `user_id`
2. In athlete-related contexts, replace with: `profile_id`
3. **Keep `userId` variable names** - those reference the user ID passed from the frontend
4. **Only change database column references**

**Example of what to change:**
```typescript
// ❌ BEFORE (in database queries):
.from('athlete_badges')
.select('*')
.eq('user_id', userId)  // ← Change this column name

// ✅ AFTER:
.from('athlete_badges')
.select('*') 
.eq('profile_id', userId)  // ← Column name changed, variable name stays
```

## 🔄 Alternative Solution (Easier)

Instead of updating code, you could modify the schema to use `user_id` as the column name instead of `profile_id`. Here's a quick fix schema:

```sql
-- Option B: Modify schema to match existing code
-- Change all 'profile_id' to 'user_id' in the athlete tables
ALTER TABLE athlete_badges RENAME COLUMN profile_id TO user_id;
ALTER TABLE athlete_vitals RENAME COLUMN profile_id TO user_id;
ALTER TABLE athlete_socials RENAME COLUMN profile_id TO user_id;
ALTER TABLE athlete_performances RENAME COLUMN profile_id TO user_id;
ALTER TABLE athlete_season_highlights RENAME COLUMN profile_id TO user_id;

-- Update foreign key constraints to still reference profiles(id)
-- (The references will still work, just the column name changes)
```

## 🚀 Recommended Approach

**Option 1: Update Code (Recommended)**
- More consistent with database naming conventions
- `profile_id` clearly indicates what it references
- Future-proof

**Option 2: Rename Columns (Quick Fix)**  
- Faster to implement
- Matches existing code
- Less disruption

## ✅ After Updates

1. Run the schema: `supabase-athlete-schema-working.sql`
2. Update code OR run column rename commands
3. Test the `/athlete` page
4. Verify data saves correctly

## 🧪 Quick Test

After making changes, test:
```javascript
// Should work without errors:
const { data } = await supabase
  .from('athlete_badges')
  .select('*')
  .eq('profile_id', userId); // or 'user_id' if you renamed
```

---

**Current Status:** Schema ready, code updates needed  
**Next Step:** Choose Option 1 (update code) or Option 2 (rename columns)