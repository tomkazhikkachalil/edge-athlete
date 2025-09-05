# Devlog 006: Create Post Modal Refactor

## Date: 2025-09-05

## Summary
Refactored the Create Post modal from a multi-step wizard to a clean single-screen design with sport selection dropdown, improving UX and reducing complexity.

## Changes Made

### 1. Single Screen Design Implementation
- **Before**: Multi-step wizard with Type → Media → Stats → Caption flow
- **After**: All sections on one screen with dynamic visibility
- Removed step navigation and progress indicators
- All content stacked vertically for immediate access

### 2. Sport Selection Dropdown
- Added searchable dropdown/input field at top of modal
- Default selection: "Media Only"
- Options include:
  - Media Only (enabled)
  - Golf (enabled with full stats form)
  - Hockey, Volleyball (disabled placeholders showing "Coming Soon")
- Click or focus interaction opens dropdown
- Real-time search filtering

### 3. Dynamic Stats Form
- Stats form appears only when Golf is selected
- Two modes: "Round Recap" and "Hole Highlight"
- Form fields:
  - Round Recap: Date, Course, Score, Holes, FIR%, GIR%, Total Putts
  - Hole Highlight: Date, Course, Hole#, Par, Score, Club Used
- Instant visibility toggle based on sport selection

### 4. Media Upload Section
- Always visible regardless of sport selection
- Required for "Media Only" posts
- Optional for sport posts
- Drag-and-drop with file browser fallback
- Grid display with delete buttons

### 5. Caption Auto-Generation
- "Generate from stats" button for Golf posts
- Creates formatted captions:
  - Round: "78 at Pebble Beach | FIR 11/14 | GIR 9/18 | 30 putts"
  - Hole: "Hole 5: Birdie on Par 4"

### 6. State Management Improvements
- Added `dropdownOpen` state for dropdown control
- Changed default `selectedType` to 'general' (Media Only)
- Added `searchQuery` for real-time filtering
- Proper cleanup in reset function

### 7. Bug Fixes
- Fixed React key warning for sport selection buttons
- Fixed SportAdapter property access (sportKey vs sport_key)
- Fixed display property mapping (icon_id, display_name)
- Removed all debug console.log statements

## Technical Details

### File Changes
- `/src/components/CreatePostModal.tsx` - Complete rewrite for single screen
- `/src/app/athlete/page.tsx` - Removed debug logging, fixed lint errors
- Used SportAdapter pattern correctly with getSportDefinition()

### Validation Rules
- Media Only: Requires at least one media file
- Golf Round Recap: Requires date and score
- Golf Hole Highlight: Requires date, hole number, and score
- Submit button disabled until validation passes

## Testing Notes
- Sport dropdown opens on click/focus
- Selecting Golf shows stats form immediately
- Switching back to Media Only hides stats form
- Disabled sports show "Coming Soon" toast
- Caption generation works with partial stats
- Form validation prevents submission without required fields

## Future Improvements
- Add more sports (when adapters are implemented)
- Add draft saving to localStorage
- Add media reordering functionality
- Implement course autocomplete for Golf
- Add more caption generation templates

## Known Issues
- Build has some remaining lint warnings (non-critical)
- Image elements using `<img>` instead of Next.js `<Image>` (performance warning)
- Some unused imports in related components need cleanup

## Acceptance Criteria Met
✅ Single screen design implemented
✅ Sport dropdown with search at top
✅ Dynamic stats form for Golf
✅ Media upload always visible
✅ Caption auto-generation working
✅ Proper validation and state management
✅ Clean removal of debug output