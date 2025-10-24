# Shared Round Scorecard - Implementation Plan

**Feature**: Multi-player golf scorecards with owner creation, participant attestation, and collaborative score entry

**Goal**: Enable one shared round post to show all participants with compact view in feed and detailed per-hole scorecard on expand

---

## 📋 Overview

### Key Capabilities
1. **Shared Round Creation**: Owner creates one round, adds multiple participants
2. **Quick View (Feed)**: Compact card showing participants + totals only
3. **Full Scorecard (Expanded)**: Per-hole grid for all participants
4. **Participant Attestation**: Players confirm participation and add/edit their own scores
5. **Flexible Holes**: Support any hole count (5, 9, 12, 18, etc.)
6. **Indoor/Outdoor**: Clearly labeled with appropriate context

---

## 🗄️ Database Schema

### 1. New Table: `shared_golf_rounds`

```sql
CREATE TABLE shared_golf_rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Round details
  course_name TEXT NOT NULL,
  course_id UUID REFERENCES golf_courses(id) ON DELETE SET NULL,
  round_type TEXT NOT NULL CHECK (round_type IN ('outdoor', 'indoor')),
  date DATE NOT NULL,
  holes_played INTEGER NOT NULL CHECK (holes_played > 0 AND holes_played <= 18),

  -- Outdoor-specific (nullable for indoor)
  tee_color TEXT,
  slope_rating INTEGER,
  course_rating NUMERIC(4,1),

  -- Environmental (outdoor only)
  weather_conditions TEXT,
  temperature INTEGER,
  wind_speed INTEGER,

  -- Post association
  post_id UUID REFERENCES posts(id) ON DELETE SET NULL,

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shared_rounds_owner ON shared_golf_rounds(owner_id);
CREATE INDEX idx_shared_rounds_post ON shared_golf_rounds(post_id);
CREATE INDEX idx_shared_rounds_date ON shared_golf_rounds(date DESC);
```

---

### 2. New Table: `shared_round_participants`

```sql
CREATE TABLE shared_round_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_id UUID REFERENCES shared_golf_rounds(id) ON DELETE CASCADE NOT NULL,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Attestation status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'declined')),
  attested_at TIMESTAMPTZ,

  -- Owner can pre-fill scores
  scores_entered_by TEXT, -- 'owner' or 'participant'
  scores_confirmed BOOLEAN DEFAULT FALSE,

  -- Aggregated scores (calculated)
  total_score INTEGER,
  to_par INTEGER,
  holes_completed INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(round_id, profile_id)
);

CREATE INDEX idx_participants_round ON shared_round_participants(round_id);
CREATE INDEX idx_participants_profile ON shared_round_participants(profile_id);
CREATE INDEX idx_participants_status ON shared_round_participants(status);
```

---

### 3. New Table: `shared_round_scores`

```sql
CREATE TABLE shared_round_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID REFERENCES shared_round_participants(id) ON DELETE CASCADE NOT NULL,

  -- Per-hole scoring
  hole_number INTEGER NOT NULL CHECK (hole_number > 0 AND hole_number <= 18),
  strokes INTEGER NOT NULL CHECK (strokes > 0 AND strokes <= 15),
  putts INTEGER CHECK (putts >= 0 AND putts <= strokes),

  -- Optional stats
  fairway_hit BOOLEAN,
  green_in_regulation BOOLEAN,

  -- Metadata
  entered_by UUID REFERENCES profiles(id) ON DELETE SET NULL, -- who entered this score
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(participant_id, hole_number)
);

CREATE INDEX idx_scores_participant ON shared_round_scores(participant_id);
CREATE INDEX idx_scores_hole ON shared_round_scores(hole_number);
```

---

### 4. Triggers for Auto-Calculation

```sql
-- Function to calculate participant totals
CREATE OR REPLACE FUNCTION calculate_participant_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE shared_round_participants
  SET
    total_score = (
      SELECT COALESCE(SUM(strokes), 0)
      FROM shared_round_scores
      WHERE participant_id = NEW.participant_id
    ),
    holes_completed = (
      SELECT COUNT(*)
      FROM shared_round_scores
      WHERE participant_id = NEW.participant_id
    ),
    updated_at = NOW()
  WHERE id = NEW.participant_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on score insert/update/delete
CREATE TRIGGER trigger_calculate_totals_insert
AFTER INSERT ON shared_round_scores
FOR EACH ROW EXECUTE FUNCTION calculate_participant_totals();

CREATE TRIGGER trigger_calculate_totals_update
AFTER UPDATE ON shared_round_scores
FOR EACH ROW EXECUTE FUNCTION calculate_participant_totals();

CREATE TRIGGER trigger_calculate_totals_delete
AFTER DELETE ON shared_round_scores
FOR EACH ROW EXECUTE FUNCTION calculate_participant_totals();
```

---

## 🔌 API Endpoints

### 1. Create Shared Round
**POST** `/api/golf/shared-rounds`

```typescript
Request:
{
  courseId?: string;
  courseName: string;
  roundType: 'outdoor' | 'indoor';
  date: string;
  holesPlayed: number;
  teeColor?: string;
  weatherConditions?: string;
  temperature?: number;
  participants: string[]; // Array of profile IDs
  prefilledScores?: {
    [profileId: string]: {
      [holeNumber: number]: { strokes: number; putts?: number }
    }
  };
}

Response:
{
  roundId: string;
  postId: string; // Auto-created post
  participants: ParticipantStatus[];
}
```

---

### 2. Attest Participation
**POST** `/api/golf/shared-rounds/:roundId/attest`

```typescript
Request:
{
  status: 'confirmed' | 'declined';
}

Response:
{
  participant: ParticipantStatus;
  notifyOwner: boolean;
}
```

---

### 3. Add/Update Scores
**PUT** `/api/golf/shared-rounds/:roundId/scores`

```typescript
Request:
{
  scores: {
    [holeNumber: number]: { strokes: number; putts?: number }
  };
}

Response:
{
  participant: ParticipantWithScores;
  totals: { total: number; toPar: number; holesCompleted: number };
}
```

---

### 4. Get Shared Round Details
**GET** `/api/golf/shared-rounds/:roundId`

```typescript
Response:
{
  round: {
    id: string;
    courseName: string;
    roundType: 'outdoor' | 'indoor';
    date: string;
    holesPlayed: number;
    ownerId: string;
  };
  participants: {
    id: string;
    profileId: string;
    profile: Profile;
    status: 'pending' | 'confirmed' | 'declined';
    totalScore?: number;
    toPar?: number;
    holesCompleted: number;
    scores: {
      [holeNumber: number]: { strokes: number; putts?: number }
    };
  }[];
}
```

---

### 5. Manage Participants (Owner Only)
**POST** `/api/golf/shared-rounds/:roundId/participants`

```typescript
Request:
{
  action: 'add' | 'remove';
  profileIds: string[];
}

Response:
{
  participants: ParticipantStatus[];
}
```

---

## 🎨 UI Components

### 1. Compact Quick View (Feed Card)

**File**: `/src/components/golf/SharedRoundQuickView.tsx`

```typescript
interface SharedRoundQuickViewProps {
  round: SharedRound;
  participants: Participant[];
  onExpand: () => void;
  isOwner: boolean;
}

// Layout:
// ┌─────────────────────────────────────┐
// │ 🌲 Pebble Beach • Mar 15 • 18 holes │
// │ ────────────────────────────────────│
// │ 👤 John Doe      74 (+2)  ✓ Confirmed│
// │ 👤 Jane Smith    72 (E)   ✓ Confirmed│
// │ 👤 Bob Johnson   --       ⏳ Pending │
// │ ────────────────────────────────────│
// │          View full scorecard →      │
// └─────────────────────────────────────┘
```

**Features**:
- Course name + indoor/outdoor badge
- Date + holes played
- Participant avatars + names
- Status badges (Confirmed ✓, Pending ⏳, No scores)
- Quick totals for confirmed players
- "Through N" indicator if partial
- Expand button

---

### 2. Full Scorecard View (Expanded)

**File**: `/src/components/golf/SharedRoundFullCard.tsx`

```typescript
interface SharedRoundFullCardProps {
  round: SharedRound;
  participants: ParticipantWithScores[];
  currentUserId?: string;
  isOwner: boolean;
  onClose: () => void;
}

// Layout (classic scorecard grid):
// ┌──────────────────────────────────────┐
// │ Pebble Beach • 18 Holes • Mar 15     │
// │ ─────────────────────────────────────│
// │ Hole │ 1│ 2│ 3│ 4│ 5│ 6│ 7│ 8│ 9│OUT│
// │ Par  │ 4│ 5│ 4│ 4│ 3│ 5│ 4│ 4│ 4│ 37│
// │──────────────────────────────────────│
// │ John │ 4│ 6│ 4│ 5│ 3│ 5│ 4│ 4│ 5│ 40│
// │ Jane │ 4│ 5│ 3│ 4│ 3│ 4│ 4│ 4│ 4│ 35│
// │ Bob  │ -│ -│ -│ -│ -│ -│ -│ -│ -│ - │
// │ (Pending scores)                     │
// └──────────────────────────────────────┘
```

**Features**:
- Traditional scorecard grid layout
- Hole headers (only holes played)
- Par row (if known)
- One row per participant
- Empty cells for missing scores
- "Add scores" affordance for own row
- Totals column (Out/In/Total/To Par)
- Compact on mobile (scrollable)

---

### 3. Score Entry Modal

**File**: `/src/components/golf/ScoreEntryModal.tsx`

```typescript
interface ScoreEntryModalProps {
  roundId: string;
  holesPlayed: number;
  existingScores?: { [hole: number]: HoleScore };
  onSave: (scores: HoleScores) => Promise<void>;
  onClose: () => void;
}

// Mobile-friendly numeric keypad UI:
// ┌─────────────────────┐
// │ Hole 1 (Par 4)      │
// │ ┌─────┬─────┬─────┐ │
// │ │  3  │  4  │  5  │ │
// │ ├─────┼─────┼─────┤ │
// │ │  6  │  7  │  8  │ │
// │ └─────┴─────┴─────┘ │
// │ Putts: [2]          │
// │ ────────────────────│
// │ ← Back   Next →     │
// └─────────────────────┘
```

---

### 4. Participant Status Badge

**File**: `/src/components/golf/ParticipantStatusBadge.tsx`

```typescript
interface StatusBadgeProps {
  status: 'pending' | 'confirmed' | 'declined';
  scoresEntered: boolean;
}

// Variants:
// ✓ Confirmed (green)
// ⏳ Pending (yellow)
// ❌ Declined (red)
// 📝 Awaiting scores (blue)
```

---

## 🔔 Notifications

### New Notification Types

Add to `/src/lib/notifications.tsx`:

```typescript
// 1. Participant invited to round
{
  type: 'shared_round_invite',
  title: '{actor_name} added you to a round',
  message: '{course_name} • {date}',
  action_url: '/golf/shared-rounds/{round_id}/attest'
}

// 2. Participant confirmed/added scores
{
  type: 'shared_round_scores_added',
  title: '{actor_name} added their scores',
  message: '{total_score} ({to_par})',
  action_url: '/golf/shared-rounds/{round_id}'
}

// 3. Owner requests scores
{
  type: 'shared_round_score_request',
  title: '{actor_name} is waiting for your scores',
  message: '{course_name} • {date}',
  action_url: '/golf/shared-rounds/{round_id}/add-scores'
}
```

---

## 🔒 Permissions & Privacy

### Access Control Rules

```typescript
// Who can view a shared round?
function canViewSharedRound(round: SharedRound, userId: string): boolean {
  // Owner can always view
  if (round.owner_id === userId) return true;

  // Participants can view
  const isParticipant = round.participants.some(p => p.profile_id === userId);
  if (isParticipant) return true;

  // Others can view if round's post is public
  if (round.post?.visibility === 'public') return true;

  return false;
}

// Who can edit scores?
function canEditScores(participant: Participant, userId: string, isOwner: boolean): boolean {
  // Participant can edit their own scores
  if (participant.profile_id === userId) return true;

  // Owner can pre-fill ONLY if participant hasn't confirmed yet
  if (isOwner && participant.status === 'pending' && !participant.scores_confirmed) {
    return true;
  }

  return false;
}
```

---

## 📱 User Flows

### Flow 1: Owner Creates Shared Round

1. Owner opens "Create Post" → "Golf Round"
2. Fills course, date, holes played
3. **NEW**: Clicks "Add participants" button
4. Search/select golfers (friends, followers)
5. **OPTIONAL**: Pre-fill scores for quick posting
   - Enter scores for each player per hole
   - Mark as "preliminary"
6. Post goes live immediately
7. Participants receive notification: "You were added to a round"

---

### Flow 2: Participant Attests & Adds Scores

1. Receives notification: "Attest & Add Scores"
2. Clicks notification → Attestation screen
3. Options:
   - ✓ Confirm → proceeds to score entry
   - ✗ Decline → removed from scorecard
4. If owner pre-filled:
   - Shows: "Review scores entered by {owner_name}"
   - Can edit any hole
   - Saves as "confirmed" (their version wins)
5. If no pre-fill:
   - Opens score entry modal
   - Per-hole numeric keypad
   - Validates (1-15 strokes per hole)
6. Saves → updates Quick View card
7. Owner notified: "{name} added scores: 74 (+2)"

---

### Flow 3: Late Joiner Added

1. Owner: "Manage participants" → Add {new_player}
2. New player receives invite notification
3. Attests + adds scores (same as Flow 2)
4. Card updates with new row
5. All participants can see updated scorecard

---

### Flow 4: Score Conflicts

**Scenario**: Owner pre-filled 76 for John, John enters 74

**Resolution**:
1. John's version (74) wins for his row
2. Owner sees notification: "John updated scores: 74 (-2 from your entry)"
3. Owner can message John if needed
4. No auto-revert (player owns their scores)

---

## 🧪 Testing Scenarios

### Test Case 1: Basic Shared Round
- Owner creates round with 3 participants
- Pre-fills 2 participants' scores
- All 3 confirm and add/edit scores
- Verify totals calculated correctly
- Check Quick View and Full Card display

### Test Case 2: Partial Rounds
- Create 12-hole round (not 9 or 18)
- Some players complete 12, others complete 9
- Verify "Through N" indicators
- Check totals only count entered holes

### Test Case 3: Indoor Round
- Create indoor round (no tees/slope)
- Add participants with scores
- Verify indoor badge shows
- Check environmental fields hidden

### Test Case 4: Declined Participant
- Owner adds 4 players
- 1 player declines
- Verify their row removed from scorecard
- Check owner sees status update

### Test Case 5: Late Score Entry
- Round posted with 2 participants
- Both attest but don't add scores immediately
- 3 days later, both add scores
- Card updates correctly

---

## 🚀 Implementation Phases

### Phase 1: Database & API (2-3 hours)
- [ ] Create 3 new tables with migrations
- [ ] Add calculation triggers
- [ ] Build 5 API endpoints
- [ ] Test with Postman/curl

### Phase 2: Quick View Component (2 hours)
- [ ] Build SharedRoundQuickView component
- [ ] Integrate into PostCard
- [ ] Add expand/collapse logic
- [ ] Test with mock data

### Phase 3: Full Scorecard View (3 hours)
- [ ] Build SharedRoundFullCard component
- [ ] Create responsive grid layout
- [ ] Handle variable hole counts
- [ ] Add empty state handling

### Phase 4: Score Entry UI (2-3 hours)
- [ ] Build ScoreEntryModal
- [ ] Create numeric keypad interface
- [ ] Add per-hole validation
- [ ] Implement save/cancel

### Phase 5: Attestation Flow (2 hours)
- [ ] Build attestation screen
- [ ] Handle confirm/decline logic
- [ ] Show pre-filled scores for review
- [ ] Connect to notifications

### Phase 6: Owner Management (1-2 hours)
- [ ] Add participant management UI
- [ ] "Request scores" action
- [ ] Pre-fill scores interface
- [ ] Handle conflicts gracefully

### Phase 7: Integration & Polish (2-3 hours)
- [ ] Integrate into post creation flow
- [ ] Add notification handlers
- [ ] Test all user flows end-to-end
- [ ] Mobile responsiveness check
- [ ] Error handling & edge cases

---

## 📊 Success Metrics

**What "Done" Looks Like**:
- ✅ Owner can create one shared round post with multiple golfers
- ✅ Quick View shows compact participant list + totals
- ✅ Full Card expands to show per-hole grid
- ✅ Participants can attest and add/edit only their scores
- ✅ Works for any hole count (5, 9, 12, 18, etc.)
- ✅ Indoor/outdoor clearly labeled
- ✅ Partial rounds handled ("Through N")
- ✅ Notifications sent at key events
- ✅ Mobile-friendly on all screens
- ✅ Privacy rules enforced

---

## 🎯 Next Steps

**Recommended Approach**: Implement in phases, testing each incrementally.

**Start with**: Phase 1 (Database & API) to establish foundation, then build UI components on top.

**MVP Timeline**: 15-20 hours for full implementation

**Want me to start building?** I can begin with Phase 1 (database schema and API endpoints) right now.
