# Athlete Profile Setup Guide

## Database Schema Setup

To set up the athlete profile database schema, you need to run the SQL migration in your Supabase project.

### Step 1: Run Database Migration

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the contents of `athlete-profile-schema.sql`
4. Click "Run" to execute the migration

This will create:
- Extended `profiles` table with athlete-specific fields
- `athlete_badges` table for achievements and certifications
- `sports` table for tracking sports played
- `season_highlights` table for seasonal performance metrics
- `performances` table for individual competition results
- Storage buckets for avatars and badge icons
- Row Level Security policies for data protection
- Indexes for performance optimization

### Step 2: Verify Setup

After running the migration, verify that the following tables exist:
- `profiles` (extended)
- `athlete_badges`
- `sports`
- `season_highlights`
- `performances`

### Step 3: Storage Configuration

The migration creates two storage buckets:
- `avatars`: For profile pictures (public read, user-owned write)
- `badges`: For badge icons (public read)

## Application Features

### Athlete Profile Page (`/athlete`)

The athlete profile page includes:

1. **Header Section**
   - Avatar image with fallback placeholder
   - Full name or "Add your name" prompt
   - Username or "Set your username" prompt
   - Logout button

2. **Badges Section**
   - Color-coded achievement badges
   - Empty state: "No badges yet. Earn some by competing!"

3. **Vitals Section**
   - Height (formatted as feet/inches)
   - Weight (formatted as pounds)
   - Age (calculated from date of birth)
   - Class year
   - Graceful "—" placeholders for empty values

4. **About & Social Section**
   - Bio with "Add a bio..." prompt when empty
   - Location with fallback
   - Social media links (Twitter, Instagram, Facebook)
   - Empty state prompts for each social platform

5. **Season Highlights**
   - Grid of seasonal performance cards
   - Sport-specific metrics
   - Rating system (0-100)
   - Empty state with trophy icon and encouragement

6. **Recent Performances Table**
   - Date, Event, Result, Time/Score, Organization columns
   - Sortable by date (most recent first)
   - Empty state with chart icon and guidance

7. **Media/Stats Tabs**
   - Media tab: Placeholder for photos/videos
   - Stats tab: Placeholder for detailed analytics
   - Both tabs show appropriate empty states

## Data Model

### Profiles (Extended)
- Basic athlete info (name, bio, location)
- Physical attributes (height, weight, DOB)
- Social media handles
- Avatar image URL

### Athlete Badges
- Achievement labels (e.g., "NCAA D1", "Team Captain")
- Color coding for visual organization
- Positioning for display order
- Optional icon images

### Sports
- Sport identification (hockey, volleyball, track, etc.)
- Active flag for displayed sports

### Season Highlights
- Sport-specific seasonal metrics
- Flexible numeric fields (metric_a, metric_b, metric_c)
- Rating system for overall performance
- Season identification (e.g., "2024-25")

### Performances
- Competition results tracking
- Event details and placement
- Performance statistics
- Athletic scoring (0-100)
- Organization/league information

## Row Level Security

All tables implement RLS with policies ensuring:
- Users can only access their own data (`profile_id = auth.uid()`)
- Full CRUD operations for data owners
- No cross-user data exposure
- Secure storage bucket access

## Empty State Handling

Every section renders gracefully when empty:
- **Placeholder text**: "—" for numeric values
- **Encouragement prompts**: "Add..." for user actions
- **Contextual icons**: Visual cues for empty states
- **Helpful guidance**: Next steps for users

## Usage

1. Users sign up and are redirected to `/athlete`
2. Empty profile shows all sections with placeholders
3. Users can view their empty profile structure
4. Future: Add edit functionality to populate data
5. Profile grows organically as users add information

## Development Notes

- All database operations use the `AthleteService` class
- TypeScript interfaces ensure type safety
- Responsive design works on mobile and desktop
- FontAwesome icons provide consistent visual language
- Tailwind CSS for styling with proper accessibility
- Loading states prevent layout shifts
- Error handling for failed data operations

The implementation prioritizes user experience by showing the complete profile structure even when empty, encouraging users to fill in their information progressively.