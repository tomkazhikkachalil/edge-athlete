# Golf Round Conditions & Course Difficulty Fields - Setup Guide

## Overview
This guide explains how to add weather conditions, temperature, wind, and course difficulty fields to golf rounds in the database.

## Current Status

### ❌ Fields NOT in Database (Yet)
The following fields are **currently missing** from the `golf_rounds` table:
- `weather` (TEXT) - Weather conditions during the round
- `temperature` (INTEGER) - Temperature in Fahrenheit
- `wind` (TEXT) - Wind conditions during the round
- `course_rating` (DECIMAL) - USGA Course Rating
- `slope_rating` (INTEGER) - USGA Slope Rating

### ✅ Fields Already Captured in UI
The **GolfScorecardForm** component (`src/components/GolfScorecardForm.tsx`) already has input fields for:
- Weather
- Temperature
- Wind
- Course Rating
- Course Slope

However, these fields are **not being saved** to the database because the columns don't exist yet.

### ✅ Display Already Implemented
The **PostCard** component (`src/components/PostCard.tsx`) already has code to display these fields when available (lines 552-586).

## Setup Instructions

### Step 1: Run Database Migration

**Location:** `add-golf-round-conditions.sql`

**Instructions:**
1. Open Supabase Dashboard: https://app.supabase.com
2. Navigate to your project
3. Go to **SQL Editor** (left sidebar)
4. Click **New Query**
5. Copy and paste the entire contents of `add-golf-round-conditions.sql`
6. Click **Run** (or press Cmd/Ctrl + Enter)

**What it does:**
```sql
ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS weather TEXT;
ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS temperature INTEGER;
ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS wind TEXT;
ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS course_rating DECIMAL(4,1);
ALTER TABLE golf_rounds ADD COLUMN IF NOT EXISTS slope_rating INTEGER;
```

### Step 2: Verify Migration

After running the migration, verify the columns were added:

```sql
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'golf_rounds'
  AND column_name IN ('weather', 'temperature', 'wind', 'course_rating', 'slope_rating')
ORDER BY column_name;
```

**Expected output:**
| column_name    | data_type        | is_nullable |
|----------------|------------------|-------------|
| course_rating  | numeric          | YES         |
| slope_rating   | integer          | YES         |
| temperature    | integer          | YES         |
| weather        | text             | YES         |
| wind           | text             | YES         |

### Step 3: Update Golf Round Creation Code

Ensure the golf round creation API saves these fields. Check:

**File:** `src/app/api/golf/route.ts` (or wherever golf rounds are created)

The API should accept and save these fields:
```typescript
const roundData = {
  // ... existing fields
  weather: data.weather,
  temperature: data.temperature,
  wind: data.wind,
  course_rating: data.courseRating,
  slope_rating: data.courseSlope,
};
```

## Field Specifications

### Weather (TEXT)
- **Description:** General weather conditions during the round
- **Examples:** "Sunny", "Cloudy", "Rainy", "Partly Cloudy", "Overcast"
- **Display:** Shows with cloud-sun icon (☁️)
- **Optional:** Yes

### Temperature (INTEGER)
- **Description:** Temperature in Fahrenheit during the round
- **Range:** Typically 0-120°F
- **Examples:** 72, 85, 45
- **Display:** Shows with thermometer icon (🌡️) and "°F" suffix
- **Optional:** Yes

### Wind (TEXT)
- **Description:** Wind conditions during the round
- **Examples:** "Calm", "Light Breeze", "Windy", "Strong Winds", "Gusts"
- **Display:** Shows with wind icon (💨)
- **Optional:** Yes

### Course Rating (DECIMAL 4,1)
- **Description:** USGA Course Rating (difficulty for a scratch golfer)
- **Range:** Typically 65.0-80.0
- **Format:** One decimal place (e.g., 75.5, 72.3)
- **Examples:** 75.5, 72.0, 78.1
- **Display:** Shows as "Rating: 75.5"
- **Optional:** Yes

### Slope Rating (INTEGER)
- **Description:** USGA Slope Rating (relative difficulty, 113 is average)
- **Range:** 55-155 (per USGA standards)
- **Examples:** 113, 145, 128
- **Display:** Shows as "Slope: 145"
- **Optional:** Yes

## How It Displays in Posts

Once the migration is complete and data is saved, the fields will display in golf round posts like this:

```
[Golf Ball Icon] Pebble Beach Golf Links
Oct 15 • White Tees • 18 Holes

[Score Badge: 85 (+13)]

Putts: 32  FIR: 64%  GIR: 56%

☁️ Sunny  🌡️ 72°F  💨 Light Breeze  Rating: 75.5  Slope: 145

[View Scorecard (18 holes)]
```

**Display Logic:**
- Only shows the second row (weather/conditions) if at least ONE field has data
- Each field displays independently (won't show blank spaces for missing data)
- Wraps to multiple lines on smaller screens
- Uses icons for weather, temperature, and wind
- Uses text labels for rating and slope

## UI Components Updated

### ✅ PostCard.tsx (Lines 552-586)
**Status:** Already updated to display these fields

**Features:**
- Conditional rendering (only shows if data exists)
- Icon-based display for weather, temperature, wind
- Text-based display for course rating and slope
- Responsive flex-wrap layout
- Consistent styling with existing stats bar

### ✅ GolfScorecardForm.tsx
**Status:** Already has input fields for all these values

**Features:**
- Weather dropdown/input
- Temperature number input
- Wind dropdown/input
- Course rating from course database or manual input
- Course slope from course database or manual input

## Testing Checklist

After running the migration:

1. ✅ Create a new golf round with weather data
2. ✅ Verify data saves to database
3. ✅ View the post and confirm fields display correctly
4. ✅ Test with partial data (only some fields filled)
5. ✅ Test with no weather data (should not show the section)
6. ✅ Test on mobile/tablet for responsive layout

## Troubleshooting

### Migration Fails
- **Error:** "column already exists"
  - **Solution:** This is safe! The `IF NOT EXISTS` clause prevents errors. The column is already there.

### Fields Not Saving
- **Check:** Is the API route updated to accept these fields?
- **Check:** Is the form data being passed correctly?
- **Check:** Check browser console for any errors during save

### Fields Not Displaying
- **Check:** Did the migration run successfully?
- **Check:** Does the post have data in these fields?
- **Check:** Check browser console for any TypeScript errors

## Benefits

Once implemented, athletes will be able to:
- **Document playing conditions** for more context around their scores
- **Track performance** under different weather conditions
- **Show course difficulty** with official USGA ratings
- **Build more complete** round records for analysis
- **Share richer stories** about their golf experiences

## Related Files

- **Migration:** `add-golf-round-conditions.sql`
- **Display Component:** `src/components/PostCard.tsx` (lines 552-586)
- **Input Form:** `src/components/GolfScorecardForm.tsx`
- **API Route:** `src/app/api/golf/` (needs update to save new fields)
- **Type Definitions:** `src/lib/supabase.ts` (could add GolfRound interface)

## Next Steps

1. ✅ Run the migration SQL in Supabase
2. ⏳ Update the golf round creation API to save these fields
3. ⏳ Test creating a round with all fields populated
4. ⏳ Verify the display in posts
5. ⏳ (Optional) Add validation for temperature range and slope rating range
