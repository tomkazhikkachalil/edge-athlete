# Sport Settings Migration - Quick Start

## 🎯 What This Does

**Problem:** Golf-specific columns (`golf_handicap`, `golf_driver_brand`, etc.) in the `profiles` table block multi-sport expansion.

**Solution:** Move sport-specific settings to a new `sport_settings` table with JSONB storage.

**Result:** Add new sports (hockey, basketball, etc.) without any schema changes!

---

## ⚡ Quick Implementation (5 Minutes)

### **1. Run Migration (2 min)**

```bash
# Copy this file:
cat migrate-to-sport-settings.sql

# Paste into Supabase Dashboard → SQL Editor → Run
```

### **2. Verify Data Migrated (30 sec)**

```sql
-- Run this in Supabase SQL Editor:
SELECT COUNT(*) FROM sport_settings WHERE sport_key = 'golf';
-- Should match number of profiles with golf data
```

### **3. Test Frontend (2 min)**

```bash
# Start server
npm run dev

# Open app → Login → Edit Profile → Golf tab
# Change handicap → Save → Refresh → Verify it persisted
```

**Done!** If all 3 steps work, your migration is successful.

---

## 📁 Files Changed

| File | What Changed |
|------|--------------|
| `migrate-to-sport-settings.sql` | **NEW** - Migration script |
| `src/app/api/sport-settings/route.ts` | **NEW** - API endpoint |
| `src/lib/supabase.ts` | Added `SportSettings`, `GolfSettings` interfaces |
| `src/components/EditProfileTabs.tsx` | Golf/Equipment tabs now use API |

---

## 🔥 Before & After

### **BEFORE (Old Way)**

```typescript
// profiles table had golf columns:
golf_handicap: 12
golf_home_course: "Pebble Beach"
golf_driver_brand: "Titleist"
// ... 9 golf-specific columns

// To add hockey, need to add MORE columns:
hockey_position: "center"
hockey_stick_flex: 85
// BAD: 100+ columns for 10 sports!
```

### **AFTER (New Way)**

```typescript
// profiles table is clean (no sport-specific columns)

// sport_settings table stores ALL sports:
{
  profile_id: "user-123",
  sport_key: "golf",
  settings: {
    handicap: 12,
    home_course: "Pebble Beach",
    driver_brand: "Titleist"
  }
}

{
  profile_id: "user-123",
  sport_key: "ice_hockey",
  settings: {
    position: "center",
    stick_flex: 85
  }
}

// GOOD: One table, infinite sports!
```

---

## 🚀 Adding Hockey (Example)

With this migration done, adding hockey is trivial:

```typescript
// In EditProfileTabs.tsx (future)
const saveHockeySettings = async () => {
  await fetch('/api/sport-settings', {
    method: 'PUT',
    body: JSON.stringify({
      sport: 'ice_hockey',
      settings: {
        position: hockeyForm.position,
        stick_flex: hockeyForm.stick_flex,
        shot_preference: hockeyForm.shot_preference,
        blade_curve: hockeyForm.blade_curve
      }
    })
  });
};
```

**NO DATABASE CHANGES NEEDED!** ✨

---

## ⚠️ Important Notes

1. **Old columns are NOT dropped yet** - They're still in the database as a safety backup
2. **Data is migrated automatically** - Existing golf data is copied to `sport_settings`
3. **Both systems work** - Old columns still have data, new API uses `sport_settings`
4. **Drop old columns later** - After 24+ hours of testing (see implementation guide)

---

## 🧪 Testing Checklist

Quick test before launching to users:

- [ ] Migration script runs without errors
- [ ] Can view existing golf settings in Edit Profile
- [ ] Can update golf settings and they persist
- [ ] Can update equipment settings and they persist
- [ ] New user can add golf settings from scratch
- [ ] No console errors
- [ ] `/api/sport-settings` API returns 200 OK

**If all checked:** You're good to go! 🎉

---

## 📊 Database Schema (New)

```sql
sport_settings
├── id (UUID, PK)
├── profile_id (UUID, FK → profiles.id)
├── sport_key (TEXT, e.g., 'golf', 'ice_hockey')
├── settings (JSONB, sport-specific data)
├── created_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)

UNIQUE(profile_id, sport_key) -- One settings record per sport per user
```

**Indexes:**
- `profile_id` (fast lookup)
- `sport_key` (filter by sport)
- `(profile_id, sport_key)` (composite)
- `settings` (JSONB queries)

**RLS Policies:**
- Users can only view/edit their own settings
- Automatic enforcement via Supabase

---

## 🔄 API Endpoints

### **GET** `/api/sport-settings?sport=golf`
Fetch settings for a specific sport

**Response:**
```json
{
  "sportKey": "golf",
  "settings": {
    "handicap": 12,
    "home_course": "Pebble Beach",
    ...
  },
  "exists": true
}
```

### **PUT** `/api/sport-settings`
Update/create settings for a sport

**Request:**
```json
{
  "sport": "golf",
  "settings": {
    "handicap": 10,
    "home_course": "Augusta National"
  }
}
```

### **DELETE** `/api/sport-settings?sport=golf`
Remove all settings for a sport

---

## 🎓 TypeScript Types

```typescript
import type { GolfSettings, SportSettings } from '@/lib/supabase';

// Golf-specific settings
const golfSettings: GolfSettings = {
  handicap: 12,
  home_course: 'Pebble Beach',
  tee_preference: 'white',
  dominant_hand: 'right',
  driver_brand: 'Titleist',
  driver_loft: 10.5,
  irons_brand: 'Mizuno',
  putter_brand: 'Scotty Cameron',
  ball_brand: 'Pro V1'
};

// Generic sport settings (database record)
const record: SportSettings = {
  id: 'uuid',
  profile_id: 'user-id',
  sport_key: 'golf',
  settings: golfSettings,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z'
};
```

---

## 🎯 Next Steps After This Migration

1. ✅ **Complete this migration** (test thoroughly)
2. ✅ **Mobile testing** (Phase 2 of roadmap)
3. ✅ **Add second sport** (hockey or basketball)
4. ✅ **Launch to 100 users**

You've just removed the **only architectural blocker** to multi-sport expansion! 🚀

---

## 📖 Full Documentation

See `SPORT_SETTINGS_IMPLEMENTATION_GUIDE.md` for:
- Step-by-step migration instructions
- Detailed testing procedures
- Troubleshooting guide
- Rollback plan
- Future sport expansion examples

---

**Questions?** Check the implementation guide or ask!
