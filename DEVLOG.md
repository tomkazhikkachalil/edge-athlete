# Development Log

## April 11, 2026 (Session 2)

### Threaded Comments with Pinning & Smart Sort

Rebuilt the comment system into a full threaded conversation layer — replies nest under parents, post owners can pin a comment, and the sort order surfaces the best content first.

**CommentSection rewrite (`src/components/CommentSection.tsx`):**
- `useMemo` organizes comments into root comments and a `repliesByParent` map
- Sort order: pinned first → most liked → chronological
- Replies sorted chronologically within each parent thread
- Reply form per comment with emoji + GIF pickers
- Pinned comments show amber thumbtack icon + "Pinned" label
- Pin button visible only to the post owner on root-level comments
- 32px avatars for root comments, 24px for replies, indented with left border

**Comments API (`src/app/api/comments/route.ts`):**
- GET: Sort updated to `is_pinned DESC → likes_count DESC → created_at ASC`
- POST: Now counts actual rows via admin client and syncs `posts.comments_count`
- DELETE: Fetches `post_id` before deletion, recounts, syncs cached column
- New PATCH handler: Pin/unpin comments (post owner only, one pinned per post)

**Migration (`016_comment_pinning.sql`):**
- `is_pinned BOOLEAN DEFAULT FALSE` column on `post_comments`
- Partial index on `post_id WHERE is_pinned = TRUE`

---

### In-App Post Sharing (Message-First)

Made internal messaging the primary share destination. Tapping Share on a post opens a modal with contacts front and center; external options are secondary.

**New file (`src/components/SharePostModal.tsx`):**
- Fetches conversations from `GET /api/messages` on open
- Frequent contacts row: first 8 DM conversations as horizontal scrollable avatars
- Full conversation list with search (client-side filter by name)
- Multi-send: `sent` Set tracks which conversations received the post
- Sends `{ type: 'shared_post', shared_post_id }` to existing message API
- Secondary section: Copy Link + native Web Share API

**PostCard changes (`src/components/PostCard.tsx`):**
- `handleShare` replaced clipboard/Web Share with `setShowShareModal(true)`
- Comment icon now opens comment section and scrolls to it (`useRef` + `scrollIntoView`)
- `commentSectionOpen` state controls CommentSection visibility
- CommentSection receives `postOwnerId` and `isOpen` props

---

### Like & Comment Count Accuracy

Fixed inconsistent like/comment counts by making the API the single source of truth.

**Like API (`src/app/api/posts/like/route.ts`):**
- After like/unlike: counts actual rows from `post_likes` table
- Syncs `posts.likes_count` cached column with true count

**Comments API:** Same pattern — POST and DELETE both recount and sync.

**Database triggers (`015_fix_like_comment_count_triggers.sql`):**
- `update_post_likes_count()` trigger on INSERT/DELETE on `post_likes`
- `update_post_comments_count()` trigger on INSERT/DELETE on `post_comments`
- One-time recount of all existing posts
- All references fully schema-qualified (`public.posts`, `public.post_likes`, etc.)

---

### Trigger Schema Qualification Fix

Fixed PostgreSQL trigger functions that used `SET search_path = ''` but referenced tables and functions without `public.` prefix, causing likes and comments to silently fail.

**Migration (`014_fix_notification_actor_name.sql`):**
- Fixed 7 trigger functions: `notify_post_like`, `notify_post_comment`, `notify_new_follower`, `notify_follow_request`, `notify_follow_request_accepted`, `notify_mention`, `notify_shared_post`
- All now use `public.posts`, `public.get_actor_display_name()`, `public.create_notification()`

---

### Security & Stability Fixes

**Search API (`src/app/api/search/route.ts`):**
- Added `sanitizeForFilter()` to prevent PostgREST injection via search terms

**Messages API (`src/app/api/messages/route.ts`):**
- UUID validation on participant IDs
- Fixed DM lookup to check both participant orderings
- Parallel unread count queries

**Vitals API (`src/app/api/vitals/route.ts`):**
- NaN/Infinity validation on numeric inputs

**Vitals config (`src/lib/vitals-config.ts`):**
- `parseTimeToSeconds` bounds validation and `Math.floor` fix

**AddVitalModal (`src/components/AddVitalModal.tsx`):**
- `parseTimeToSeconds` format parameter fix

**Notifications (`src/lib/notifications.tsx`):**
- Extracted shared `getNotificationText()` function used by `NotificationBell`, notifications page, and app notifications page

**Other cleanup:**
- Removed dead `MobileNav.tsx` component
- Removed duplicate Messages button from `AppHeader`
- Fixed `TypingIndicator` `useRef` cleanup
- Fixed feed pagination (>= 20 instead of === 20)

---

## April 11, 2026

### MVP Messaging System

Built a full real-time messaging layer — DMs, group chats, rich media sharing, typing indicators, and unread badges.

**Database (`012_messaging.sql`):**
- 5 new tables: `conversations`, `conversation_participants`, `messages`, `message_reactions`, `user_blocks`
- `messaging_permission` column on `profiles` (`everyone` / `fans_only` / `mutual_fans` / `nobody`)
- `is_conversation_participant()` SECURITY DEFINER helper powers all RLS policies
- Trigger auto-bumps `conversations.updated_at` on every new message
- Extended `notifications` type CHECK to include `new_message`

**API (10 new routes):**
- `GET/POST /api/messages` — list conversations, create DM or group (respects messaging permission)
- `GET /api/messages/unread-count` — aggregate unread badge count
- `GET /api/messages/[conversationId]` — cursor-paginated message history + participants
- `POST /api/messages/[conversationId]/messages` — send message, fan-out notifications
- `PATCH /api/messages/[conversationId]/read` — mark conversation read
- `PATCH /api/messages/[conversationId]` — update group name / avatar / mute
- `POST/DELETE /api/messages/[conversationId]/participants` — add/remove members
- `DELETE /api/messages/[conversationId]/messages/[messageId]` — soft-delete
- `POST /api/messages/block` — block user + close DM

**New files:**
- `src/lib/messages.tsx` — `MessagesProvider` with per-conversation Realtime subscriptions + 30s poll fallback
- `src/types/messages.ts` — full TypeScript types for all messaging entities
- `src/components/messages/` — `ConversationList`, `ConversationItem`, `ChatWindow` (flex-col-reverse + IntersectionObserver infinite scroll), `MessageBubble` (5 types + soft-delete), `MessageInput` (auto-resize textarea + file attach), `TypingIndicator` (broadcast channel, 3s auto-clear), `SharedPostPreview`, `SharedProfilePreview`, `NewConversationModal`, `GroupSettingsModal`, `MessagesBell`
- `src/components/settings/MessagingSettings.tsx` — 4-option permission radio cards
- `src/app/messages/page.tsx` — desktop split-pane (`?c=` param), mobile full-width list
- `src/app/messages/[conversationId]/page.tsx` — mobile-primary, redirects to `?c=` on desktop

**Modified:** `AppHeader`, `MobileNav`, `settings/page.tsx`, `layout.tsx`

---

### Emoji + GIF Picker

Added emoji and GIF support to the message composer and post comment input.

**New files:**
- `src/components/EmojiPickerButton.tsx` — lazy-loaded picker, opens upward, inserts Unicode at cursor
- `src/components/GifPicker.tsx` — debounced Giphy search, trending on open, 2-column grid, GIPHY attribution
- `src/app/api/gifs/search/route.ts` — server-side Giphy proxy (API key never exposed to browser)
- `database/migrations/013_comment_gif.sql` — adds `gif_url TEXT` column to `post_comments`

**Modified:**
- `MessageInput` — emoji + GIF buttons; GIFs use CDN URL directly, no upload needed
- `CommentSection` — emoji + GIF toolbar; GIF-only comments supported; renders inline
- `POST /api/comments` — accepts and persists `gif_url`
- `Comment` interface — `content` made nullable; `gif_url?: string | null` added

**DB fix:** `post_comments.content` dropped `NOT NULL` constraint to allow GIF-only comments.

---

## April 8, 2026

### Vitals Tracking — Full Feature Build

Built the complete Vitals tab on athlete profiles for long-term physical development tracking. Every entry is an immutable historical record. No overwriting — only appending.

**New files:**
- `database/migrations/010_vitals_tracking.sql` — `athlete_vitals` table with append-only RLS (no UPDATE/DELETE policies), `source` column for future wearable integrations
- `src/lib/vitals-config.ts` — 4 categories, 18 metrics, time parsing/formatting utilities, progression helpers
- `src/app/api/vitals/route.ts` — GET (vitals + training posts + athlete birthday) and POST (always inserts, never updates)
- `src/components/AddVitalModal.tsx` — Category/metric selection, time format handling (mm:ss and decimal seconds), back-datable date input
- `src/components/VitalsTab.tsx` — Metric cards with current value, personal best, first recorded + age context, progression delta, years tracked, trend arrow; inline history grouped by year; training activity feed

**Modified:**
- `src/components/ProfileMediaTabs.tsx` — Replaced vitals "coming soon" with live `VitalsTab`
- `src/lib/sports/SportRegistry.ts` — Added `training` as an enabled sport
- `src/lib/config/sports-config.ts` — Added training icon, color, and Tailwind classes

---

### Vitals Media — Metric + Post Feature

Extended the Vitals system so athletes can optionally attach photos or video when logging a vital, making a bench press PR or sprint clip shareable as a visual post while keeping the structured time-series record clean.

**Architecture:** `athlete_vitals` remains the source of truth. A vital entry can optionally link to a `posts` row via `linked_post_id`. Linked posts use `sport_key='training'` and appear in the Training Activity feed automatically.

**Transactional safety:** The three-step flow (upload media → create post → create vital) handles all failure modes explicitly. If the vital insert fails after the post is created, the orphaned post is deleted automatically.

**Changes:**
- `database/migrations/011_vitals_linked_post.sql` — Nullable `linked_post_id` FK with `ON DELETE SET NULL` and sparse index
- `POST /api/posts` — Now accepts `'training'` as a valid `postType` and an optional `stats_data` field for non-golf posts
- `POST /api/vitals` — Accepts and persists optional `linked_post_id`
- `AddVitalModal` — Mode toggle: "Metric only" (quick entry) vs "Add media" (caption + media upload + visibility). Same 5MB/4-file/image+video rules as `CreatePostModal`.
- `PostCard` — Violet dumbbell badge for posts with `stats_data.type='vitals_entry'` showing metric label + value
- `VitalsTab` — Camera icon on history entries with a linked post; clicking opens the post in `PostDetailModal` inline

---

## April 7, 2026

### Feed & Login Cleanup
Removed all placeholder/fake UI that was misleading for early users.

**Feed page (`src/app/feed/page.tsx`):**
- Removed fake Stories section (hardcoded "Athlete 1–6" placeholders)
- Removed Explore Reels placeholder grid
- Replaced Upcoming Events with honest empty state ("coming soon")
- Replaced Your Teams with Your Club empty state ("coming soon")
- Wired Photo/Video, Stats, Achievement quick-action buttons to open the create post modal (were styled but had no `onClick` handlers)

**Login page (`src/app/page.tsx`):**
- Removed Google, Facebook, Apple OAuth buttons — they had no click handlers and did nothing on press. Email/password login is the primary auth method for the MVP.

---

### Mobile App Crash Fix
Fixed a crash that prevented the app from loading on mobile devices entirely.

**Root Cause:** `src/app/layout.tsx` loaded Tailwind CSS from CDN via `<script async>`, followed by an inline script setting `tailwind.config = {...}`. On slow mobile connections, the CDN script hadn't loaded when the inline script ran, causing `ReferenceError: tailwind is not defined` — crashing the entire React tree.

**Fix:** Removed both scripts. Tailwind CSS 4 is already fully compiled at build time via `@tailwindcss/postcss` — the CDN script was redundant.

---

### Black Media Images Fix (Tailwind CSS v3 → v4 Migration)
Fixed all media images appearing as solid black squares in post feeds and the profile media grid.

**Root Cause (two layers):**

1. **`LazyImage` component** used an IntersectionObserver + `opacity-0` initial state. If `onLoad` was slow, images stayed invisible on top of the `bg-black` media container in `PostCard`.

2. **Tailwind CSS v3 → v4 breaking change** — `bg-opacity-*` utilities were removed in Tailwind CSS 4. After removing the CDN v3 script, every `bg-black bg-opacity-0` rendered as solid black at full opacity. The media grid overlay (`absolute inset-0 bg-black bg-opacity-0`) was a black sheet covering every image. This also broke all modal backdrops, carousel buttons, and hover overlays across the entire app.

**Fixes:**
- `LazyImage`: Replaced IntersectionObserver + opacity trick with a gray skeleton overlay (`z-10`) that sits on top while the image loads. Image always renders so `onLoad` fires reliably.
- `PostCard`: Changed media container from `bg-black` → `bg-gray-100` (neutral fallback).
- Global: Replaced all `bg-opacity-*` / `hover:bg-opacity-*` / `group-hover:bg-opacity-*` with Tailwind v4 slash syntax (`bg-black/50`, `hover:bg-black/70`, etc.) across **25 files**.

---

## April 3, 2026

### Build-Breaking Fix: Module-Level Supabase Clients
Fixed production build failures caused by Supabase clients being created at module scope in API routes. During static analysis, Next.js evaluates module-level code where environment variables aren't available, causing `supabaseUrl is required` errors.

**Root Cause:** 26 API route files created Supabase admin clients (`createClient(...)`) at the top of the file outside request handlers.

**Fix:**
- Added `getSupabaseAdmin()` lazy factory function to `src/lib/auth-server.ts`
- Moved all Supabase client creation inside request handler `try` blocks
- Replaced module-level env var constants with inline `process.env` references

**Files Changed (27):**
- `src/lib/auth-server.ts` — Added `getSupabaseAdmin()` helper
- 26 API routes under `src/app/api/` — Moved client init into handlers

### Golf Stats Endpoint Fix
Fixed `/api/golf/stats` returning 500 errors due to querying a non-existent `total_score` column.

**Fix:** Removed `total_score` from the SELECT query and all calculation references in `src/app/api/golf/stats/route.ts`. The correct column is `gross_score`.

### Notification Routes Auth Fix
Fixed all notification API routes returning 500 instead of 401 for unauthenticated requests.

**Root Cause:** `requireAuth()` throws a `Response` object on auth failure, but catch blocks didn't check for it, wrapping the 401 as a generic 500.

**Fix:** Added `if (error instanceof Response) return error;` to catch blocks in 7 handlers across 5 files:
- `notifications/route.ts` (GET, DELETE)
- `notifications/unread-count/route.ts` (GET)
- `notifications/preferences/route.ts` (GET, PATCH)
- `notifications/mark-all-read/route.ts` (PATCH)
- `notifications/[id]/route.ts` (PATCH, DELETE)
- `notifications/[id]/action/route.ts` (POST)

**Verification:**
- Build: Passing (57 pages, 54 API routes, 0 errors)
- Lint: No warnings or errors
- All 22 database tables accessible
- All notification endpoints return 401 for unauthenticated requests

---

## January 8, 2026

### Mobile Navigation Fix
Fixed non-functional buttons in the mobile navigation drawer:

**Before:** "Explore" and "Fans" buttons had no click handlers
**After:** Replaced with working navigation links:
- **Saved Posts** → `/athlete/saved`
- **Notifications** → `/app/notifications`

**File Changed:** `src/components/MobileNav.tsx`

---

### Connection Suggestions Feature Fix
Fixed the "People you may know" suggestions feature which was failing due to SQL issues:

**Root Cause:**
- Multiple versions of `generate_connection_suggestions` function with different return types
- Missing `connection_suggestions` table for dismiss functionality
- RPC function parameter names mismatch between API and database

**Changes Made:**

1. **Created comprehensive migration:** `database/migrations/fix-suggestions-feature-complete.sql`
   - Creates `connection_suggestions` table with proper schema
   - Adds RLS policies for the new table
   - Drops all old function versions
   - Creates corrected `generate_connection_suggestions` function
   - Adds proper indexes for performance

2. **Improved API route:** `src/app/api/suggestions/route.ts`
   - Added TypeScript interface for `ConnectionSuggestion`
   - Fixed RPC parameter names (`p_user_profile_id`, `p_suggestion_limit`)
   - Improved fallback logic to exclude already-followed profiles
   - Better error logging with structured error details
   - Created Supabase client per-request instead of module level

**To Apply:**
Run the migration in Supabase SQL Editor:
```
database/migrations/fix-suggestions-feature-complete.sql
```

**Database Schema Alignment:**
Also fixed `src/app/api/public/profile/route.ts` and `src/lib/supabase.ts`:
- Removed `position` and `team` from profile queries (not in current DB schema)
- Fixed golf rounds query to use `gross_score` instead of `total_score`

---

## December 10, 2025

### Fan Terminology Update
Replaced all "Follow/Following/Followers" terminology with fan-based wording across the entire UI:

| Old Term | New Term |
|----------|----------|
| Follow | Become a Fan |
| Following (status) | You're a Fan |
| Following (list) | Fan Of |
| Followers | Fans |
| Follow request | Fan request |
| Unfollow | Unfollow (kept) |
| Remove Follower | Remove Fan |

**Files Updated (14 total):**
- `src/components/FollowButton.tsx`
- `src/components/FollowersModal.tsx`
- `src/components/PrivateProfileView.tsx`
- `src/components/NotificationsDropdown.tsx`
- `src/components/EditProfileTabs.tsx`
- `src/components/AppHeader.tsx`
- `src/components/MobileNav.tsx`
- `src/components/settings/AccountSettings.tsx`
- `src/app/athlete/page.tsx`
- `src/app/athlete/[id]/page.tsx`
- `src/app/u/[username]/page.tsx`
- `src/app/notifications/page.tsx`
- `src/app/app/notifications/page.tsx`
- `src/app/app/followers/page.tsx`

### Enhanced Fans Modal
Implemented bidirectional relationship management in the Fans modal:

**On Your Own Profile (Fans List):**
- See all your fans with profile photo, name, sport/school
- "Become a Fan" button to follow them back
- "Unfollow" button if already following
- "Remove Fan" button to remove them from your fans
- All buttons always visible (no hover menus)

**On Another User's Profile (Fans List):**
- Discover fans of that athlete
- "Become a Fan" / "Unfollow" buttons for each person
- No "Remove Fan" button (owner-only privilege)

**Button Styles:**
- **Become a Fan**: Blue background (`bg-blue-600`)
- **Unfollow**: Gray background (`bg-gray-200`)
- **Remove Fan**: Red text on light red (`text-red-600 bg-red-50`)

---

## Project Status

**Build:** Passing (63 static pages, 0 errors)
**Lint:** No warnings or errors
**Deployment:** Vercel (auto-deploy on push to main)
**Last Verified:** April 11, 2026

---

## Tech Stack
- Next.js 15.5.7 (App Router)
- React 19
- Supabase (Auth, Database, Storage)
- TypeScript (strict mode)
- Tailwind CSS 4
