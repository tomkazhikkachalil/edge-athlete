# Adding Sports with Stats - Developer Guide

## Overview

This guide explains how to add new sports with detailed stats/metrics that can be expanded and viewed in posts. The system is designed to be sport-agnostic and easily extensible.

## Current Implementation: Golf Example

Golf serves as the reference implementation with:
- Summary stats (score, putts, FIR%, GIR%)
- **Expandable hole-by-hole scorecard** (using HTML `<details>` element)
- Course information
- Weather conditions
- All data viewable in feed AND modal

## Architecture Pattern

### 1. Database Schema

For each sport with detailed stats, create two tables:

```sql
-- Main performance table
CREATE TABLE {sport}_games (
  id UUID PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id),
  date DATE,
  opponent TEXT,
  location TEXT,
  -- Sport-specific summary fields
  total_points INT,
  -- ... other summary stats
);

-- Detailed breakdown table
CREATE TABLE {sport}_quarters ( -- or periods/innings/etc
  id UUID PRIMARY KEY,
  game_id UUID REFERENCES {sport}_games(id),
  quarter_number INT,
  -- Detailed stats per period
  points_scored INT,
  -- ... other detailed stats
);
```

**Golf Example:**
```sql
golf_rounds (round summary) → golf_holes (hole-by-hole details)
```

**Future Examples:**
```sql
basketball_games → basketball_quarters
soccer_matches → soccer_periods
hockey_games → hockey_periods
baseball_games → baseball_innings
```

### 2. Posts Integration

Link the performance to a post via a foreign key:

```sql
ALTER TABLE posts ADD COLUMN {sport}_id UUID REFERENCES {sport}_games(id);
```

**Golf Example:**
```sql
posts.round_id → golf_rounds.id
```

**Future Examples:**
```sql
posts.game_id → basketball_games.id
posts.match_id → soccer_matches.id
```

### 3. PostDetailModal Data Loading

Add sport-specific data loading in `src/components/PostDetailModal.tsx`:

```typescript
// =====================================================
// SPORT-SPECIFIC DATA LOADING
// =====================================================

// Golf (existing)
let golfRound = null;
if (data.round_id && data.sport_key === 'golf') {
  const { data: roundData } = await supabase
    .from('golf_rounds')
    .select(`
      *,
      golf_holes (*)
    `)
    .eq('id', data.round_id)
    .single();
  golfRound = roundData;
}

// Basketball (example)
let basketballGame = null;
if (data.game_id && data.sport_key === 'basketball') {
  const { data: gameData } = await supabase
    .from('basketball_games')
    .select(`
      *,
      basketball_quarters (
        quarter_number,
        points_scored,
        rebounds,
        assists,
        steals,
        blocks
      )
    `)
    .eq('id', data.game_id)
    .single();

  // Sort quarters by number
  if (gameData && gameData.basketball_quarters) {
    gameData.basketball_quarters.sort((a, b) =>
      a.quarter_number - b.quarter_number
    );
  }

  basketballGame = gameData;
}

// Add to transformed post
const transformedPost = {
  ...data,
  golf_round: golfRound,
  basketball_game: basketballGame, // Add new sport data
  // ...
};
```

### 4. PostCard Display Component

Add sport-specific display logic in `src/components/PostCard.tsx`:

```typescript
// Golf scorecard (existing example)
{post.sport_key === 'golf' && post.golf_round && (
  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4">
    {/* Summary stats */}
    <div>Score: {post.golf_round.gross_score}</div>

    {/* Expandable detailed stats */}
    {post.golf_round.golf_holes && post.golf_round.golf_holes.length > 0 && (
      <details className="group">
        <summary className="cursor-pointer">
          <i className="fas fa-chevron-right group-open:rotate-90"></i>
          View Scorecard ({post.golf_round.golf_holes.length} holes)
        </summary>
        <div>
          {/* Hole-by-hole table */}
          <table>...</table>
        </div>
      </details>
    )}
  </div>
)}

// Basketball box score (example)
{post.sport_key === 'basketball' && post.basketball_game && (
  <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4">
    {/* Summary stats */}
    <div>
      <div>Final Score: {post.basketball_game.total_points}</div>
      <div>Opponent: {post.basketball_game.opponent}</div>
    </div>

    {/* Expandable quarter-by-quarter breakdown */}
    {post.basketball_game.basketball_quarters &&
     post.basketball_game.basketball_quarters.length > 0 && (
      <details className="group">
        <summary className="cursor-pointer">
          <i className="fas fa-chevron-right group-open:rotate-90"></i>
          View Quarter Breakdown
        </summary>
        <div>
          {/* Quarter-by-quarter table */}
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th>Q</th>
                <th>PTS</th>
                <th>REB</th>
                <th>AST</th>
              </tr>
            </thead>
            <tbody>
              {post.basketball_game.basketball_quarters.map(quarter => (
                <tr key={quarter.quarter_number}>
                  <td>Q{quarter.quarter_number}</td>
                  <td>{quarter.points_scored}</td>
                  <td>{quarter.rebounds}</td>
                  <td>{quarter.assists}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    )}
  </div>
)}
```

## Key Principles

### 1. Always Use Expandable Sections for Detailed Stats

Use HTML `<details>` and `<summary>` for expandability:

```tsx
<details className="group">
  <summary className="cursor-pointer text-sm font-medium hover:text-blue-600">
    <i className="fas fa-chevron-right group-open:rotate-90 transition-transform"></i>
    View Detailed Stats
  </summary>
  <div className="mt-3">
    {/* Detailed content here */}
  </div>
</details>
```

**Benefits:**
- ✅ Works in feed AND modal
- ✅ No JavaScript state management needed
- ✅ Accessible (keyboard navigation)
- ✅ Lightweight
- ✅ Native browser support

### 2. Summary + Details Pattern

Every sport should have:

**Summary Section (Always Visible):**
- Key metrics (score, result, opponent)
- Date, location, conditions
- Quick stats (2-4 key numbers)

**Details Section (Expandable):**
- Period-by-period breakdown
- Advanced stats
- Play-by-play (if applicable)
- Notes/highlights

### 3. Consistent Visual Design

Use sport-specific color themes:

```tsx
// Golf: Green
<div className="bg-gradient-to-br from-green-50 to-green-100 ...">

// Basketball: Orange
<div className="bg-gradient-to-br from-orange-50 to-orange-100 ...">

// Soccer: Blue
<div className="bg-gradient-to-br from-blue-50 to-blue-100 ...">

// Hockey: Ice blue
<div className="bg-gradient-to-br from-cyan-50 to-cyan-100 ...">
```

### 4. Data Sorting

Always sort detailed stats in logical order:

```typescript
// Golf: Sort holes 1-18
golf_holes.sort((a, b) => a.hole_number - b.hole_number);

// Basketball: Sort quarters 1-4
basketball_quarters.sort((a, b) => a.quarter_number - b.quarter_number);

// Baseball: Sort innings 1-9
baseball_innings.sort((a, b) => a.inning_number - b.inning_number);
```

## Complete Example: Adding Basketball

### Step 1: Create Database Tables

```sql
-- Create basketball_games table
CREATE TABLE basketball_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  opponent TEXT NOT NULL,
  location TEXT,
  result TEXT, -- 'win' or 'loss'
  final_score INT,
  opponent_score INT,
  minutes_played INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create basketball_quarters table
CREATE TABLE basketball_quarters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES basketball_games(id) ON DELETE CASCADE,
  quarter_number INT NOT NULL,
  points_scored INT,
  rebounds INT,
  assists INT,
  steals INT,
  blocks INT,
  turnovers INT,
  fouls INT,
  UNIQUE(game_id, quarter_number)
);

-- Add game_id to posts
ALTER TABLE posts ADD COLUMN game_id UUID REFERENCES basketball_games(id);

-- Create indexes
CREATE INDEX idx_basketball_games_profile ON basketball_games(profile_id);
CREATE INDEX idx_basketball_quarters_game ON basketball_quarters(game_id);
CREATE INDEX idx_posts_game_id ON posts(game_id);
```

### Step 2: Update PostDetailModal.tsx

```typescript
// In fetchPost function, add after golf section:

let basketballGame = null;
if (data.game_id && data.sport_key === 'basketball') {
  const { data: gameData } = await supabase
    .from('basketball_games')
    .select(`
      *,
      basketball_quarters (
        quarter_number,
        points_scored,
        rebounds,
        assists,
        steals,
        blocks,
        turnovers,
        fouls
      )
    `)
    .eq('id', data.game_id)
    .single();

  if (gameData && gameData.basketball_quarters) {
    gameData.basketball_quarters.sort((a, b) =>
      a.quarter_number - b.quarter_number
    );
  }

  basketballGame = gameData;
  console.log('[PostDetailModal] Loaded basketball game:', gameData);
}

// Add to transformedPost:
const transformedPost = {
  ...data,
  profile: data.profiles,
  media: data.post_media || [],
  golf_round: golfRound,
  basketball_game: basketballGame, // Add this
};
```

### Step 3: Update PostCard.tsx

```typescript
// Add after golf section (around line 600):

{post.sport_key === 'basketball' && post.basketball_game && (
  <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 border-2 border-orange-200">
    <div className="flex items-center gap-2 mb-3">
      <i className="fas fa-basketball-ball text-orange-600 text-xl"></i>
      <span className="font-bold text-orange-900 text-base">
        Basketball Game
      </span>
    </div>

    {/* Game Summary */}
    <div className="space-y-1 text-sm mb-3">
      <div className="flex items-center gap-2">
        <span className="font-bold text-orange-900">vs {post.basketball_game.opponent}</span>
      </div>
      {post.basketball_game.date && (
        <div className="text-gray-700">
          {new Date(post.basketball_game.date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          })}
        </div>
      )}
      {post.basketball_game.location && (
        <div className="text-gray-600 text-xs">
          {post.basketball_game.location}
        </div>
      )}
    </div>

    {/* Final Score */}
    {post.basketball_game.final_score !== null && (
      <div className="bg-white rounded-lg p-3 mb-3">
        <div className="flex items-center justify-between">
          <div className="text-center">
            <div className="text-3xl font-black text-orange-900">
              {post.basketball_game.final_score}
            </div>
            <div className="text-xs text-gray-600">You</div>
          </div>
          <div className="text-2xl font-bold text-gray-400">-</div>
          <div className="text-center">
            <div className="text-3xl font-black text-gray-700">
              {post.basketball_game.opponent_score}
            </div>
            <div className="text-xs text-gray-600">Opponent</div>
          </div>
          <div className={`px-3 py-1 rounded-full text-sm font-bold ${
            post.basketball_game.result === 'win'
              ? 'bg-green-500 text-white'
              : 'bg-red-500 text-white'
          }`}>
            {post.basketball_game.result?.toUpperCase()}
          </div>
        </div>
      </div>
    )}

    {/* Expandable Quarter Breakdown */}
    {post.basketball_game.basketball_quarters &&
     post.basketball_game.basketball_quarters.length > 0 && (
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-orange-700 hover:text-orange-900 flex items-center gap-1 py-1">
          <i className="fas fa-chevron-right group-open:rotate-90 transition-transform text-[10px]"></i>
          View Quarter Breakdown ({post.basketball_game.basketball_quarters.length} quarters)
        </summary>
        <div className="mt-3">
          <div className="bg-white rounded border border-orange-300 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-orange-100 border-b border-orange-300">
                  <th className="text-left py-1.5 px-2 font-bold text-orange-900">Q</th>
                  <th className="text-center py-1.5 px-2 font-bold text-orange-900">PTS</th>
                  <th className="text-center py-1.5 px-2 font-bold text-orange-900">REB</th>
                  <th className="text-center py-1.5 px-2 font-bold text-orange-900">AST</th>
                  <th className="text-center py-1.5 px-2 font-bold text-orange-900">STL</th>
                  <th className="text-center py-1.5 px-2 font-bold text-orange-900">BLK</th>
                  <th className="text-center py-1.5 px-2 font-bold text-orange-900">TO</th>
                </tr>
              </thead>
              <tbody>
                {post.basketball_game.basketball_quarters.map((quarter: any, idx: number) => (
                  <tr
                    key={quarter.quarter_number}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-orange-50'}
                  >
                    <td className="py-1.5 px-2 font-bold text-orange-900">
                      Q{quarter.quarter_number}
                    </td>
                    <td className="text-center py-1.5 px-2 font-semibold text-gray-800">
                      {quarter.points_scored || 0}
                    </td>
                    <td className="text-center py-1.5 px-2 text-gray-700">
                      {quarter.rebounds || 0}
                    </td>
                    <td className="text-center py-1.5 px-2 text-gray-700">
                      {quarter.assists || 0}
                    </td>
                    <td className="text-center py-1.5 px-2 text-gray-700">
                      {quarter.steals || 0}
                    </td>
                    <td className="text-center py-1.5 px-2 text-gray-700">
                      {quarter.blocks || 0}
                    </td>
                    <td className="text-center py-1.5 px-2 text-gray-700">
                      {quarter.turnovers || 0}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="bg-orange-200 border-t-2 border-orange-400 font-bold">
                  <td className="py-1.5 px-2 text-orange-900">TOTAL</td>
                  <td className="text-center py-1.5 px-2 text-orange-900">
                    {post.basketball_game.basketball_quarters.reduce(
                      (sum: number, q: any) => sum + (q.points_scored || 0), 0
                    )}
                  </td>
                  <td className="text-center py-1.5 px-2 text-orange-900">
                    {post.basketball_game.basketball_quarters.reduce(
                      (sum: number, q: any) => sum + (q.rebounds || 0), 0
                    )}
                  </td>
                  <td className="text-center py-1.5 px-2 text-orange-900">
                    {post.basketball_game.basketball_quarters.reduce(
                      (sum: number, q: any) => sum + (q.assists || 0), 0
                    )}
                  </td>
                  <td className="text-center py-1.5 px-2 text-orange-900">
                    {post.basketball_game.basketball_quarters.reduce(
                      (sum: number, q: any) => sum + (q.steals || 0), 0
                    )}
                  </td>
                  <td className="text-center py-1.5 px-2 text-orange-900">
                    {post.basketball_game.basketball_quarters.reduce(
                      (sum: number, q: any) => sum + (q.blocks || 0), 0
                    )}
                  </td>
                  <td className="text-center py-1.5 px-2 text-orange-900">
                    {post.basketball_game.basketball_quarters.reduce(
                      (sum: number, q: any) => sum + (q.turnovers || 0), 0
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </details>
    )}
  </div>
)}
```

## Testing Checklist

When adding a new sport:

- [ ] Database tables created with proper foreign keys
- [ ] Data loading added to PostDetailModal.tsx
- [ ] Display component added to PostCard.tsx
- [ ] Summary stats visible without expansion
- [ ] Detailed stats expandable with `<details>`
- [ ] Works in feed view
- [ ] **Works in modal view** (most important!)
- [ ] Proper sorting of periods/quarters/innings
- [ ] Sport-specific color theme applied
- [ ] Empty states handled (no data)
- [ ] Responsive on mobile/tablet/desktop

## Common Pitfalls

### ❌ Don't Do This:

```typescript
// Don't use separate modals for stats
<button onClick={() => setShowStatsModal(true)}>View Stats</button>

// Don't use complex state management
const [expanded, setExpanded] = useState(false);
```

### ✅ Do This Instead:

```typescript
// Use HTML <details> for expansion
<details>
  <summary>View Stats</summary>
  <div>Stats content</div>
</details>
```

## Why This Pattern Works

1. **Simplicity** - No state management needed
2. **Consistency** - Same behavior in feed and modal
3. **Performance** - Native browser implementation
4. **Accessibility** - Keyboard navigation built-in
5. **Extensibility** - Easy to add new sports
6. **Future-proof** - Works with any type of detailed stats

## Related Files

- `src/components/PostDetailModal.tsx` - Handles data loading
- `src/components/PostCard.tsx` - Handles display
- `src/app/api/posts/route.ts` - API for fetching posts
- Database tables: `{sport}_games` and `{sport}_periods`

## Support

For questions or issues:
1. Check existing golf implementation as reference
2. Review this guide
3. Test in both feed AND modal views
4. Ensure expandable sections use `<details>` element

## Version

- **Version**: 1.0.0
- **Last Updated**: 2025-01-XX
- **Status**: ✅ Production Ready
