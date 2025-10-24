# 🗄️ Complete Supabase Database Setup Guide

## 🚀 Quick Setup

**Copy and paste the entire `database-verification.sql` file into your Supabase SQL Editor and run it.** This will set up everything automatically.

## 📊 Database Schema Overview

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `profiles` | User profiles and athlete data | `full_name`, `bio`, `height_cm`, `weight_kg`, `social_*` |
| `athlete_badges` | Achievement badges | `label`, `icon_url`, `color_token`, `position` |
| `season_highlights` | Seasonal performance data | `sport_key`, `season`, `metric_a/b/c`, `rating` |
| `performances` | Individual competition results | `date`, `event`, `result_place`, `stat_primary` |
| `sports` | Sports a user participates in | `sport_key`, `active` |

### Storage Buckets

| Bucket | Purpose | File Types | Size Limit |
|--------|---------|------------|------------|
| `avatars` | User profile pictures | Images (JPG, PNG, GIF, WebP) | 5MB |
| `badges` | Badge icons | Images (PNG, SVG) | 1MB |

## 🔐 Security Features

- **Row Level Security (RLS)** enabled on all tables
- **User isolation** - Users can only access their own data
- **Admin override** - Service role can access all data
- **Storage policies** - Users can only upload to their own folders

## 🎯 Field Mapping: UI ↔ Database

### Profile Fields (Inline Editable)
```typescript
full_name       → profiles.full_name     // Main display name
bio             → profiles.bio           // About section
height_cm       → profiles.height_cm     // Height in centimeters
weight_kg       → profiles.weight_kg     // Weight in kilograms  
dob             → profiles.dob           // Birth date (YYYY-MM-DD)
location        → profiles.location      // City, state, etc.
class_year      → profiles.class_year    // Graduation year
social_twitter  → profiles.social_twitter   // Twitter handle (no @)
social_instagram → profiles.social_instagram // Instagram handle (no @)
social_facebook → profiles.social_facebook  // Facebook handle
avatar_url      → profiles.avatar_url    // Profile picture URL
```

### Season Highlights (Modal Editable)
```typescript
sport_key    → season_highlights.sport_key  // "hockey", "volleyball", etc.
season       → season_highlights.season     // "2024-25"
metric_a     → season_highlights.metric_a   // "Goals: 15"
metric_b     → season_highlights.metric_b   // "Assists: 8" 
metric_c     → season_highlights.metric_c   // "Games: 22"
rating       → season_highlights.rating     // 85 (0-100 scale)
```

### Badges (Modal Editable)
```typescript
label        → athlete_badges.label         // "NCAA D1", "Team Captain"
icon_url     → athlete_badges.icon_url      // Badge icon image URL
color_token  → athlete_badges.color_token   // "primary", "purple", "green"
position     → athlete_badges.position      // Display order
```

## 🔄 API Integration

### Profile Updates
- **Endpoint**: `POST /api/profile`
- **Authentication**: `userId` parameter
- **Database**: Uses `supabaseAdmin` to bypass RLS
- **Tables**: Updates `profiles` table

### Season Highlights
- **Endpoint**: `POST /api/season-highlights`  
- **Authentication**: `userId` parameter
- **Database**: Uses `supabaseAdmin` to bypass RLS
- **Tables**: Upserts to `season_highlights` table

### Avatar Uploads
- **Endpoint**: `POST /api/upload/avatar`
- **Authentication**: `userId` parameter  
- **Storage**: Uploads to `avatars` bucket
- **Database**: Updates `profiles.avatar_url`

## 🛠️ Data Types & Constraints

### Text Fields
- All social handles stored without @ prefix
- Metrics stored as text for flexibility (e.g., "Goals: 15", "Time: 2:30")
- Location accepts any format (city, state, country combinations)

### Numeric Fields  
- Heights in centimeters (integer)
- Weights in kilograms (integer)
- Ratings 0-100 scale (numeric with check constraint)

### Date Fields
- Birth dates stored as DATE type
- Timestamps use `TIMESTAMP WITH TIME ZONE`
- All dates default to UTC

## 📈 Performance Optimization

### Indexes Created
- Profile lookups: `email`, `username`
- Badge queries: `profile_id`, `position` 
- Sports queries: `profile_id`, `active`
- Highlights: `profile_id`, `season`, `sport_key`
- Performances: `profile_id`, `date DESC`

### Automatic Updates
- `updated_at` fields auto-update on changes
- Cascading deletes when profiles are deleted
- Unique constraints prevent duplicate data

## ✅ Verification Checklist

After running the SQL setup, verify:

- [ ] All 5 tables exist: `profiles`, `athlete_badges`, `sports`, `season_highlights`, `performances`
- [ ] RLS is enabled on all tables
- [ ] Storage buckets `avatars` and `badges` exist
- [ ] Profile fields match TypeScript interface
- [ ] Storage policies allow user uploads
- [ ] Indexes are created for performance

## 🔧 Troubleshooting

### Common Issues

1. **"Table doesn't exist"**: Run the full `database-verification.sql` script
2. **"Permission denied"**: Check RLS policies are created correctly  
3. **"Bucket not found"**: Ensure storage buckets are created
4. **Type mismatches**: Verify field types match TypeScript interfaces

### Debug Queries

```sql
-- Check table structure
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_name = 'profiles';

-- Verify RLS is enabled  
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public';

-- Check storage buckets
SELECT * FROM storage.buckets;
```

## 🎉 You're All Set!

Your Supabase database is now fully configured to handle:
- ✅ User profiles with all athlete data
- ✅ Badge management system
- ✅ Season highlights tracking  
- ✅ Performance history
- ✅ Avatar uploads with proper storage
- ✅ Complete security with RLS
- ✅ Optimized queries with indexes

Everything from the UI will now save directly to your Supabase database!