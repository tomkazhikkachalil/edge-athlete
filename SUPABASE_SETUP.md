# Supabase Setup Guide for Athlete Profile System

## 🎯 Ensuring All Information is Properly Stored

This guide walks through setting up your Supabase database to support the complete athlete profile system.

## 📋 Quick Checklist

- [ ] Database schema created
- [ ] All tables exist with correct columns
- [ ] RLS policies configured
- [ ] Storage bucket set up
- [ ] Test data working
- [ ] Environment variables configured

## 🗄️ Database Schema Setup

### Step 1: Run the Complete Schema

Copy and paste the entire contents of `/supabase-athlete-schema.sql` into your Supabase SQL Editor and execute it.

**What this creates:**
- ✅ Extends `profiles` table with athlete fields
- ✅ Creates 5 new athlete tables
- ✅ Sets up RLS policies
- ✅ Creates storage bucket
- ✅ Adds performance indexes
- ✅ Sets up update triggers

### Step 2: Verify Setup

Run `/database-verification-complete.sql` to verify everything is working:

```sql
-- This will check:
-- ✅ All tables exist
-- ✅ Columns are correct
-- ✅ RLS is enabled
-- ✅ Policies are active
-- ✅ Storage is configured
-- ✅ Indexes are created
```

## 🏗️ Database Tables Overview

### Extended Profiles Table
The existing `profiles` table gets these new columns:
- `display_name` - Athlete's preferred name
- `sport` - Primary sport
- `school` - Current school
- `location` - City, State
- `coach` - Coach name
- `bio` - Athlete bio
- `graduation_year` - Graduation year
- `gpa` - Grade Point Average
- `sat_score` - SAT score
- `act_score` - ACT score
- `avatar_url` - Profile image URL

### New Athlete Tables

#### 1. `athlete_badges`
```sql
- id (UUID, primary key)
- user_id (TEXT, links to auth.users)
- badge_type (TEXT, e.g. 'all_american', 'state_champion')
- display_order (INTEGER, for sorting)
- created_at, updated_at
```

#### 2. `athlete_vitals`
```sql
- id (UUID, primary key)
- user_id (TEXT, links to auth.users)
- height_feet, height_inches (INTEGER)
- weight_display (NUMERIC), weight_unit (TEXT)
- wingspan_feet, wingspan_inches (INTEGER)
- vertical_jump_inches (INTEGER)
- forty_yard_dash (NUMERIC)
- bench_press, squat, deadlift (INTEGER)
- resting_heart_rate, vo2_max (INTEGER)
- created_at, updated_at
```

#### 3. `athlete_socials`
```sql
- id (UUID, primary key)
- user_id (TEXT, links to auth.users)
- platform (TEXT, e.g. 'twitter', 'instagram')
- handle (TEXT, the username)
- created_at, updated_at
```

#### 4. `athlete_performances`
```sql
- id (UUID, primary key)
- user_id (TEXT, links to auth.users)
- event_name (TEXT, e.g. '100m Sprint')
- result (TEXT, e.g. '10.25s')
- place (INTEGER, e.g. 1 for 1st place)
- date (DATE)
- location (TEXT)
- notes (TEXT)
- public_visible (BOOLEAN, default true)
- created_at, updated_at
```

#### 5. `athlete_season_highlights`
```sql
- id (UUID, primary key)
- user_id (TEXT, links to auth.users)
- stat_name (TEXT, e.g. '100m Best')
- stat_value (TEXT, e.g. '10.25s')
- stat_context (TEXT, e.g. 'State Record')
- display_order (INTEGER, for sorting)
- season (TEXT, default '2024-2025')
- created_at, updated_at
```

## 🔒 Security Configuration

### Row Level Security (RLS) Policies

All tables have RLS enabled with these policies:

**General Pattern:**
- ✅ Users can only read/write their own data
- ✅ `user_id` field links to `auth.uid()`
- ✅ Social links are publicly readable
- ✅ Performances can be public or private

**Storage Policies:**
- ✅ Users upload to their own folder: `uploads/{user_id}/`
- ✅ Public read access for all uploaded files
- ✅ Only owners can update/delete their files

## 📁 Storage Setup

### Uploads Bucket Configuration
```sql
-- Bucket: 'uploads'
-- Public: true (for avatars and images)
-- Structure: uploads/{user_id}/filename.ext
```

**Supported File Types:**
- Images: JPG, PNG, WebP
- Max size: 5MB
- Auto-generated unique filenames

## 🔧 Environment Variables

Ensure these are set in your `.env.local`:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Database URLs (from Supabase dashboard)
DATABASE_URL=your_pooled_connection_string
DIRECT_DATABASE_URL=your_direct_connection_string
```

## 🧪 Testing the Setup

### 1. Manual Verification
Run the verification script in Supabase SQL Editor:
```sql
-- Copy/paste contents of database-verification-complete.sql
```

### 2. Application Testing
1. Start your app: `npm run dev`
2. Navigate to `/athlete`
3. Try creating and editing profiles
4. Upload an avatar image
5. Add performance data

### 3. Database Browser Check
In Supabase Dashboard:
1. Go to Table Editor
2. Verify all `athlete_*` tables exist
3. Check that test data appears
4. Verify RLS policies in Authentication > Policies

## 📊 Expected Data Flow

### Profile Creation
```
User signs up → Profile created in profiles table
→ User navigates to /athlete → Empty state displayed
→ User edits profile → Data saved to profiles + athlete_* tables
```

### Data Relationships
```
auth.users (Supabase Auth)
    ↓ user_id
profiles (extended with athlete fields)
    ↓ user_id
athlete_badges, athlete_vitals, athlete_socials,
athlete_performances, athlete_season_highlights
```

## 🚨 Troubleshooting

### Common Issues

**1. RLS Blocking Queries**
```sql
-- Check if policies exist:
SELECT * FROM pg_policies WHERE tablename LIKE '%athlete%';

-- Verify user authentication:
SELECT auth.uid(); -- Should return user ID when authenticated
```

**2. Storage Upload Fails**
```sql
-- Check bucket exists:
SELECT * FROM storage.buckets WHERE id = 'uploads';

-- Check storage policies:
SELECT * FROM pg_policies WHERE schemaname = 'storage';
```

**3. Missing Columns**
```sql
-- Check if profiles table was extended:
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'profiles' AND column_name LIKE '%sport%';
```

**4. Environment Variables**
```bash
# Verify in your app:
console.log('Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('Has service key:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
```

## 🎉 Success Indicators

When everything is working correctly, you should see:

✅ **Database:** All tables show in Supabase Table Editor  
✅ **RLS:** Policies prevent cross-user data access  
✅ **Storage:** Avatar uploads work in edit modal  
✅ **App:** Athlete page loads without errors  
✅ **Data:** Profile edits save and persist  
✅ **Performance:** Page loads under 2 seconds  

## 📝 Migration Notes

If you're upgrading from an earlier version:

1. **Backup your data** before running migrations
2. Run the schema script - it uses `IF NOT EXISTS` for safety
3. The script handles column additions gracefully
4. Test thoroughly in development first

## 🔄 Data Migration Script

If you have existing data in different table structures:

```sql
-- Example: Migrate from old badge structure
INSERT INTO athlete_badges (user_id, badge_type, display_order)
SELECT user_id, old_badge_name, old_position 
FROM old_badges_table;

-- Update display orders if needed
UPDATE athlete_badges SET display_order = row_number() OVER (PARTITION BY user_id ORDER BY created_at);
```

---

## ✅ Final Checklist

Before going to production:

- [ ] All tables created successfully
- [ ] Sample data inserts/updates/deletes work
- [ ] RLS policies tested with multiple users  
- [ ] Storage upload/download works
- [ ] Environment variables configured
- [ ] Application loads and functions correctly
- [ ] Performance is acceptable
- [ ] Error handling works for edge cases

**Status:** 🚀 Ready for Production

---

*Need help? Check the verification script output or contact your development team.*