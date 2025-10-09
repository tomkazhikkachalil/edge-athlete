# Sport Settings Migration - Implementation Guide

## ✅ What We've Done

We've successfully refactored your golf-specific profile columns into a sport-agnostic `sport_settings` table. This allows you to add new sports (hockey, basketball, etc.) without touching the database schema.

### Files Created/Modified:

1. **`migrate-to-sport-settings.sql`** - Complete database migration script
2. **`src/app/api/sport-settings/route.ts`** - New API endpoint for sport settings
3. **`src/lib/supabase.ts`** - Added TypeScript interfaces (GolfSettings, HockeySettings, SportSettings)
4. **`src/components/EditProfileTabs.tsx`** - Updated to use sport_settings API

---

## 📋 Implementation Steps

Follow these steps **in order** to safely migrate your data:

### **STEP 1: Run the Migration Script**

1. Open **Supabase Dashboard** → **SQL Editor**
2. Open the file `migrate-to-sport-settings.sql`
3. Copy the entire contents
4. Paste into Supabase SQL Editor
5. Click **"Run"**

**What this does:**
- ✅ Creates `sport_settings` table
- ✅ Creates indexes for performance
- ✅ Enables Row Level Security (RLS)
- ✅ Migrates existing golf data from `profiles` to `sport_settings`
- ⚠️ **DOES NOT drop old columns yet** (safety measure)

**Expected Output:**
```
════════════════════════════════════════════════
    SPORT SETTINGS MIGRATION COMPLETE
════════════════════════════════════════════════

Table created: sport_settings
Indexes created: 4
RLS policies: 4 (SELECT, INSERT, UPDATE, DELETE)

Migration results:
  - Profiles with golf data: X
  - Records migrated: X

✅ SUCCESS: All golf data migrated correctly!
```

If you see any errors, **STOP** and report them. Do not proceed.

---

### **STEP 2: Verify Migration**

Run these queries in Supabase SQL Editor to verify data was migrated correctly:

```sql
-- Check how many profiles have golf settings
SELECT COUNT(*) as profiles_with_golf_data
FROM profiles
WHERE
  golf_handicap IS NOT NULL
  OR golf_home_course IS NOT NULL
  OR golf_tee_preference IS NOT NULL
  OR golf_driver_brand IS NOT NULL;

-- Check how many records were migrated
SELECT COUNT(*) as migrated_records
FROM sport_settings
WHERE sport_key = 'golf';

-- These numbers should match!

-- View sample migrated data
SELECT
  p.first_name,
  p.last_name,
  s.settings
FROM sport_settings s
JOIN profiles p ON p.id = s.profile_id
WHERE s.sport_key = 'golf'
LIMIT 5;
```

**Expected:** Both counts should be the same, and you should see your golf settings in JSONB format.

---

### **STEP 3: Test the Frontend**

1. **Start your dev server:**
   ```bash
   npm run dev
   ```

2. **Open your app** in a browser

3. **Login** with an account that has golf data

4. **Go to Profile → Edit Profile**

5. **Test Golf Tab:**
   - Click on "Golf" tab
   - Verify your handicap, home course, tee preference, dominant hand are displayed
   - Change a value (e.g., update handicap)
   - Click "Save"
   - Refresh the page
   - Verify the change persisted

6. **Test Equipment Tab:**
   - Click on "Equipment" tab
   - Verify your driver, irons, putter, ball brands are displayed
   - Change a value
   - Click "Save"
   - Refresh the page
   - Verify the change persisted

7. **Check Browser Console:**
   - Open DevTools (F12)
   - Look for any errors
   - Check Network tab for `/api/sport-settings` requests
   - Verify they return 200 OK

---

### **STEP 4: Test with a New User**

1. **Create a brand new test account**
2. **Go to Edit Profile**
3. **Fill in Golf settings** (handicap, home course, etc.)
4. **Save**
5. **Refresh and verify** data is still there

This tests that the migration works for **new data**, not just migrated data.

---

### **STEP 5: Verify Database (Final Check)**

Run this query to see the new data:

```sql
-- View all sport settings
SELECT
  p.email,
  p.first_name,
  p.last_name,
  s.sport_key,
  s.settings,
  s.created_at
FROM sport_settings s
JOIN profiles p ON p.id = s.profile_id
ORDER BY s.created_at DESC;
```

You should see:
- Your existing migrated golf settings
- Any new golf settings you just created

---

### **STEP 6: Drop Old Columns (OPTIONAL - Do This Last)**

⚠️ **ONLY DO THIS AFTER EVERYTHING WORKS**

Once you've verified:
- ✅ Migration successful
- ✅ Frontend works correctly
- ✅ Data saves and loads properly
- ✅ New users can add settings
- ✅ You've tested for at least 24 hours

Then you can drop the old golf columns:

1. Open `migrate-to-sport-settings.sql`
2. Find **STEP 6** (around line 95)
3. **Uncomment** these lines:

```sql
ALTER TABLE profiles DROP COLUMN IF EXISTS golf_handicap;
ALTER TABLE profiles DROP COLUMN IF EXISTS golf_home_course;
ALTER TABLE profiles DROP COLUMN IF EXISTS golf_tee_preference;
ALTER TABLE profiles DROP COLUMN IF EXISTS golf_dominant_hand;
ALTER TABLE profiles DROP COLUMN IF EXISTS golf_driver_brand;
ALTER TABLE profiles DROP COLUMN IF EXISTS golf_driver_loft;
ALTER TABLE profiles DROP COLUMN IF EXISTS golf_irons_brand;
ALTER TABLE profiles DROP COLUMN IF EXISTS golf_putter_brand;
ALTER TABLE profiles DROP COLUMN IF EXISTS golf_ball_brand;
```

4. Run these lines in Supabase SQL Editor

**This is permanent!** But the data is safe in `sport_settings`.

---

## 🔄 Rollback Plan

If something goes wrong, you can restore the old data:

```sql
-- Restore golf data from sport_settings back to profiles
UPDATE profiles p
SET
  golf_handicap = (s.settings->>'handicap')::numeric,
  golf_home_course = s.settings->>'home_course',
  golf_tee_preference = s.settings->>'tee_preference',
  golf_dominant_hand = s.settings->>'dominant_hand',
  golf_driver_brand = s.settings->>'driver_brand',
  golf_driver_loft = (s.settings->>'driver_loft')::numeric,
  golf_irons_brand = s.settings->>'irons_brand',
  golf_putter_brand = s.settings->>'putter_brand',
  golf_ball_brand = s.settings->>'ball_brand'
FROM sport_settings s
WHERE s.profile_id = p.id AND s.sport_key = 'golf';
```

Then revert the code changes and redeploy.

---

## 🚀 Adding New Sports (Future)

Now that this is in place, adding hockey settings is easy:

```typescript
// User goes to Edit Profile → Hockey tab

// Save hockey settings (NO schema changes needed!)
await fetch('/api/sport-settings', {
  method: 'PUT',
  body: JSON.stringify({
    sport: 'ice_hockey',
    settings: {
      position: 'center',
      stick_flex: 85,
      shot_preference: 'left',
      blade_curve: 'P92'
    }
  })
});
```

The same `sport_settings` table handles ALL sports!

---

## 🐛 Troubleshooting

### **Issue: "Unauthorized" error**
- Check that you're logged in
- Verify your Supabase env variables are correct
- Check RLS policies were created

### **Issue: Golf settings not loading**
- Open browser DevTools → Network tab
- Check `/api/sport-settings?sport=golf` request
- Look for errors in response
- Verify migration ran successfully

### **Issue: Save fails**
- Check browser console for errors
- Verify request payload in Network tab
- Check Supabase logs for policy violations

### **Issue: Data not persisting**
- Check that `updated_at` trigger was created
- Verify RLS policies allow INSERT/UPDATE
- Check database logs

---

## ✅ Checklist

Before considering this complete, verify:

- [ ] Migration script ran without errors
- [ ] Record counts match (profiles with golf data = migrated records)
- [ ] Existing golf settings display correctly in UI
- [ ] Can update golf settings and changes persist
- [ ] Can update equipment settings and changes persist
- [ ] New user can add golf settings from scratch
- [ ] No console errors in browser
- [ ] API requests return 200 OK
- [ ] Database shows data in `sport_settings` table
- [ ] Tested for 24+ hours with real usage
- [ ] (Optional) Dropped old columns from profiles table

---

## 📞 Need Help?

If you encounter any issues:

1. **Check the browser console** for errors
2. **Check Supabase logs** (Dashboard → Logs)
3. **Run the verification queries** above
4. **Don't drop old columns** until everything works

The old data is still in the `profiles` table until you drop the columns, so you have a safety net.

---

## 🎯 What's Next?

Once this migration is complete:

- ✅ You can add hockey/basketball/any sport without schema changes
- ✅ Each sport manages its own settings independently
- ✅ Your database is normalized and scalable
- ✅ Ready for multi-sport expansion

**Next recommended steps:**
1. Complete this migration and test thoroughly
2. Move on to mobile responsiveness testing
3. Add your second sport (hockey or basketball)
4. Launch to 100 beta users!
