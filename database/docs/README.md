# Edge Athlete Database Documentation

## Overview
This directory contains all database-related SQL files for the Edge Athlete platform, organized for clarity and maintainability.

## Directory Structure

### `/migrations/` - Core Database Migrations
Numbered, chronological migrations that define the primary database schema. **Run these in order** when setting up a new database.

| File | Description |
|------|-------------|
| 001_initial_setup.sql | Initial Supabase setup (tables, RLS, functions) |
| 002_golf_schema.sql | Complete golf feature schema |
| 003_notifications.sql | Notification system setup |
| 004_group_posts.sql | Group posts/shared scorecard foundation |
| 005_name_migration.sql | Name structure refactor (first/middle/last) |
| 006_handles_system.sql | @handle username system |
| 007_saved_posts.sql | Saved/bookmarked posts feature |
| 008_tagging_system.sql | User tagging in posts |

### `/features/` - Feature-Specific Schemas
Organized by feature for easier navigation and updates.

- **`/golf/`** - Golf-specific tables, functions, and enhancements
- **`/notifications/`** - Notification system additions
- **`/search/`** - Full-text search implementation
- **`/tagging/`** - User tagging system

### `/tests/` - Testing & Diagnostics
Tools for verifying database health and debugging issues.

- **`/verification/`** - Schema validation scripts (verify-*, check-*)
- **`/test-data/`** - Test user creation and sample data
- **`/diagnostics/`** - Debug scripts for troubleshooting

### `/archive/` - Historical/Deprecated Files
Old migrations and superseded implementations. **Do not use** these files for new setups.

- **`/old-migrations/`** - Previous versions of features
- **`/failed-attempts/`** - Abandoned or broken migrations

## Database Technology
- **Platform**: Supabase (PostgreSQL + Extensions)
- **Auth**: Supabase Auth
- **Storage**: Supabase Storage (avatars, post media)
- **Real-time**: Supabase Realtime (optional)

## Key Database Features

### Core Tables
- `profiles` - User profiles (extends auth.users)
- `posts` - Social posts with media
- `post_media` - Image/video attachments
- `post_comments` - Threaded comments
- `follows` - Follow relationships
- `notifications` - User notifications
- `golf_rounds` - Golf round data
- `golf_holes` - Hole-by-hole scores

### Security
- **Row Level Security (RLS)** enabled on all tables
- **Privacy system** (public/private profiles)
- **Service role** bypasses RLS for admin operations

### Performance
- Optimized RLS policies (auth.uid() → `(select auth.uid())`)
- Full-text search indexes
- Automatic count management (likes_count, comments_count)

## Getting Started

1. **New Database Setup**:
   ```bash
   # Run migrations in order
   cat database/migrations/001_initial_setup.sql | supabase sql
   cat database/migrations/002_golf_schema.sql | supabase sql
   # ... continue through all numbered migrations
   ```

2. **Add a Feature**:
   - Check `/features/{feature-name}/` for relevant schemas
   - Review migration history in `/migrations/INDEX.md`

3. **Debugging**:
   - Use scripts in `/tests/verification/` to check database health
   - Run diagnostics from `/tests/diagnostics/` for specific issues

## Important Notes

⚠️ **These SQL files are documentation** - They show the database evolution history. Your Next.js app connects directly to the live Supabase database, not these files.

✅ **Safe to move/organize** - Moving these files does NOT affect the running application or database.

❌ **Do not re-run** old migrations on an existing database without understanding their impact.

## See Also
- [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) - Detailed migration instructions
- [/migrations/INDEX.md](../migrations/INDEX.md) - Complete migration history
