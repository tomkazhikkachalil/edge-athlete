# Development Log

## July 17, 2026 (continued) — Autonomous Build-Out Session

**Mode change:** User granted full autonomous mode — no per-change confirmations; stop only for anything that costs money.

### Migration 020 status — NOT applied (defensive fix shipped)
User ran 020 in the SQL Editor but live verification shows it did not land
(`posts.activity_mode` absent, dead tables still present; Postgres 42703, not
cache lag). Likely causes: wrong project in the dashboard (app uses ref
`htwhmdoiszhhmwuflgci`), the script errored + rolled back, or wrong file
pasted. **Code is now safe either way:** `api/posts` retries the insert once
without `activity_mode` on 42703/PGRST204 (`27a0b25`). **020 still needs to
run — see Pending Actions below.**

### Phase B — Sport dispatch seams (`ceb51ed`)
- PostCard 1030 → 612 lines: inline golf scorecard + stats block extracted
  verbatim to `golf/GolfRoundCard` + `golf/GolfStatsSummaryCard`, dispatched
  via new `SportPostBody` keyed on `sport_key`.
- `SportRegistry`: new `getPrimarySports()` + `TEASER_SPORT_KEYS`;
  `MultiSportActivity`/`MultiSportHighlights` now registry-derived (no
  hardcoded sport lists); activity-row nav generalized to
  `/app/sport/[sport_key]/activity/[id]`.

### Ice hockey + volleyball LIVE end-to-end (`85840a8`)
**Stat-line architecture** — zero DDL: sports whose per-game data fits a stat
line store `{type:'stat_line', sport_key, date, opponent, result, stats}` in
`posts.stats_data`. Single source of truth `src/lib/sports/stat-schemas.ts`;
composer form (`StatLineForm`), feed card (`StatLineCard` via `SportPostBody`),
profile highlights/activity (`StatLinePostAdapter` + `/api/sports/stat-lines`),
and media-tile summaries all derive from it. Adding another stat-line sport =
schema + registry enable. Both sports enabled in `SportRegistry`;
`api/posts` postType allowlist now derives from registry-enabled sports.
Activity detail page renders stat lines (was "coming soon"). The stat-lines
API enforces owner-vs-public visibility (stricter than the golf sibling —
noted as a gap to backport). Full decision record in
`docs/MULTI_SPORT_ROADMAP.md`.

### Explore page (`ae1902a`)
New `/explore` + `/api/explore`: browse-first discovery — sport filter chips
(registry-derived), responsive athlete grid, recent public activity. Public-
only server-side (posts by private-visibility authors excluded). Added to
AppHeader nav. Queries validated live against Supabase.

### Pending Actions (user)
1. ~~Run migration 020~~ ✅ **APPLIED + VERIFIED** (second attempt, July 17):
   dead columns/tables gone, `activity_mode` backfilled 17/17 posts, zero
   mismatches. `golf_mode` retained until 021 as designed.
2. **Push to deploy** when ready — all work is committed locally on `main`;
   nothing has been pushed.

### Sport-aware public profile + /api/profile security fix
- `/api/public/profile` + `u/[username]`: golf-only stats card → generic
  `sportStats {label, tiles}` (golf: rounds/avg/best; stat-line sports:
  games + top stat totals from PUBLIC posts). (`d4cf9f6`)
- **Security (`b340147`):** `/api/profile` GET+PUT had no auth — PUT could
  update any profile by id (IDOR), GET leaked full PII (email/phone/GPA/
  SAT/DOB) for any id. Now require auth + ownership; PUT strips
  id/email/timestamps + validates user_type; GET privacy-shapes
  server-side (owner=full, viewer=minus-contact, blocked=minimal).
  Verified 401 on both unauth'd endpoints via local prod server.

### 3 more sports — basketball, soccer, baseball (`e998698`) → 7 total
Stat-line architecture validated: 3 sports added with zero DDL, no
component changes. New `profileTiles` (count/sum/avg) + `computeProfileTile`
fix profile-tile aggregation (PPG/RPG now correct per-game means, not
broken sums). Live-verified basketball averages via REST round-trip.

### Verification discipline
Ice hockey + basketball verified end-to-end against LIVE data (insert via
REST → read back → run through real type-guard/schema/aggregation logic →
delete test data → confirm DB restored). Not just build-green.

**End-of-session verification:** `npx tsc --noEmit` clean; `npm run lint`
zero warnings; `npm run build` exit 0 — 67 routes. 11 commits ahead of
origin (unpushed). 7 sports live: golf (deep tables), ice hockey,
volleyball, basketball, soccer, baseball (stat-line), + training.

---

## July 17, 2026

### Session Restart — Verification, Backup, Multi-Sport Audit + Schema Cleanup (Phase A)

**Housekeeping:**
- Verified repo clean + in sync with origin; lint zero warnings; fresh production build exit 0.
- Confirmed migration 019 (messaging polish) **was applied** to Supabase — `message_reports` table and `messages.edited_at` verified live. Completed the flagged follow-up: restored `edited_at` to the messages SELECT in `GET /api/messages/[conversationId]` (without it, the "edited" indicator was lost on page reload). Committed as `0db7d7b`.
- Full project backup created at `~/Desktop/edge-athlete-backup-2026-07-17` (12 MB, excludes node_modules/.next, includes git history + .env.local). User confirmed Supabase backups in place.

**Multi-sport audit (code via subagent sweep + DB via live PostgREST inspection):**
- DB reality: 43 tables, only 6 hold data (posts 17, profiles 2, golf_rounds 9, golf_holes 108, clubs 4, privacy_settings 2).
- `posts` coupling: `golf_mode` (write-only — set in one place, read by nothing), `round_id` (live, 10 posts), `game_id`/`match_id`/`race_id` (0 rows ever, 0 code refs — speculative columns from archived "future sports" migration).
- 5 dead tables: 0 rows AND 0 code refs (`athlete_season_highlights`, `athlete_performances`, `athlete_socials`, `hockey_game_data`, `volleyball_match_data`).
- `sport_settings`: schema correct (profile_id + sport_key + JSONB), fully generic API route — but written only by EditProfileTabs' golf tab and read by no rendering code → 0 rows.
- Adapter pattern governs only profile highlights + activity table; post pipeline, PostCard scorecard (~340 inline lines), composer, 5 read APIs, equipment all bypass it. Full findings + sport-#2 work list captured in **`docs/MULTI_SPORT_ROADMAP.md`** (new).

**Phase A implemented (user-approved, including destructive drops):**
- New migration `database/migrations/020_schema_cleanup_multisport.sql`:
  - A1: recreate `idx_posts_stats_media` without dead columns; drop `game_id`/`match_id`/`race_id` + their indexes.
  - A2: drop the 5 dead tables (verified 0 rows; verification queries embedded in the file).
  - A3: add `posts.activity_mode` (no CHECK — per-sport vocabulary scoped by `sport_key`), backfill from `golf_mode`, deprecation COMMENTs on both columns. `golf_mode` kept one release for rollback; drop scheduled for 021+.
- `src/app/api/posts/route.ts`: dual-writes `activity_mode` + `golf_mode` (`'round_recap'`) on golf posts; type updated with deprecation note.

**Verified:** lint zero warnings; production build exit 0.

**Pending action (user): run `020_schema_cleanup_multisport.sql` in Supabase SQL Editor BEFORE pushing/deploying** — the insert path now writes `activity_mode`, which fails if the column doesn't exist. Verification queries are at the bottom of the migration file.

**Next planned:** Phase B seams — extract PostCard golf scorecard to `components/golf/`, move `formatGolfStatsSummary` into GolfAdapter, consolidate the two sport registries, derive MultiSport components from `getEnabledSports()`. Then either Messaging Phase 2 or mobile pass.

---

## May 24, 2026

### Messaging Polish Phase 1 + Resilience Fixes + GIF-Reaction Refactor

Multi-iteration session covering three discrete pieces of work, all in the messaging stack. End-of-session: `npm run lint` zero warnings, `npm run build` exit 0 (incremental cache).

**Part 1 — Phase 1 messaging polish (edit, report, reactor popover, recents):**
- New migration `database/migrations/019_messaging_polish.sql` — adds `messages.edited_at` (nullable) and a new `message_reports` table (`id`, `message_id`, `reported_profile_id`, `reporter_id`, `conversation_id`, `reason` CHECK across spam/harassment/hateful/sexual/violence/other, `details`, `status` CHECK across open/reviewing/resolved/dismissed, `created_at`). RLS uses the project-standard wrapped `(select auth.uid())` form and reuses the existing `is_conversation_participant()` SECURITY DEFINER helper. Indexes on `(status, created_at desc)`, `reporter_id`, `reported_profile_id`.
- New API route `PATCH /api/messages/[conversationId]/messages/[messageId]` — sender-only edit, ≤15 min from `created_at`, text-only, not deleted; updates `content` + `edited_at`. Co-located in the same file as the existing DELETE handler.
- New API route `POST /api/messages/reports` — accepts message-level or profile-level reports; resolves `conversation_id` + `reported_profile_id` from the target message server-side rather than trusting the client; rejects self-reports.
- `GET /api/messages/[conversationId]` — reactions aggregation now populates a `reactors` array per emoji so the "who reacted" popover can render without a follow-up GET.
- POST reactions toggle — same reactor enrichment so cross-user realtime broadcasts carry the same shape.
- New `src/components/messages/ReactionDetails.tsx` — popover listing reactors (avatar + display name), emoji tabs, outside-click + Escape close.
- New `src/components/messages/EditMessageInline.tsx` — inline textarea swap, Enter saves / Esc cancels, server-mirror 15-min/text-only gating.
- New `src/components/messages/ReportMessageModal.tsx` — radio reasons + optional details, submit toast confirmation, body-scroll lock while open.
- `src/components/messages/MessageBubble.tsx` — Edit (own text <15 min) + Report (others') entries in the action menu; "edited" suffix near timestamp; swaps to `EditMessageInline` in edit mode; action menu always visible so Report is reachable on every incoming message.
- `src/components/messages/ReactionBar.tsx` — chips now expose a long-press / right-click → `ReactionDetails` popover (preserves click-to-toggle); the "+" picker shows a "Recent" emoji strip (last 16, MRU) backed by `localStorage` key `ea:msg:recentEmojis`; exports `rememberRecentEmoji` for the bubble's quick-react surfaces to share.
- `src/components/GifPicker.tsx` — Recent GIFs strip (last 12) backed by `localStorage` key `ea:msg:recentGifs`; promoted on selection from trending OR search results.
- `src/app/globals.css` — `ea-reaction-pop` keyframe (180ms scale bounce) and `ea-edit-pulse` (600ms soft shadow); both respect the existing `prefers-reduced-motion` block.
- `src/types/messages.ts` — `AggregatedReaction.reactors?: ParticipantProfile[]` and `Message.edited_at?: string | null`. Both optional → no breaking change for older payloads.

**Part 2 — Resilience fixes during Phase 1 verification:**
- `GET /api/messages/[conversationId]` defensive: `edited_at` removed from the messages SELECT so the route keeps working on databases where migration 019 hasn't yet been applied (the column will flow through via the realtime postgres_changes payload once the migration is in place). Reactor profiles are fetched via a separate `SELECT … FROM profiles WHERE id IN (…)` query instead of an FK-name-based embed — eliminates dependency on PostgREST schema-cache constraint names. Same defensive pattern applied to the reactions toggle endpoint.
- `src/lib/notifications.tsx` — added `isNotificationAPISupported()` guard at module scope; wrapped the realtime Notification constructor call in try/catch; replaced the unguarded `typeof window` check before `Notification.requestPermission()` with the new helper and `.catch()` for silent rejection. Root cause of "Something went wrong" screen on first load + every page nav was an unguarded `Notification.permission` access inside the realtime callback that threw `ReferenceError` in runtimes where the global `Notification` constructor is absent (older iOS Safari, in-app browsers, some embedded WebViews); the throw escaped to the route error boundary.
- `src/app/error.tsx` + `src/app/global-error.tsx` — surfaces `error.message` (truncated to 280 chars, monospace inline panel) in dev only (`NODE_ENV !== 'production'`). Future regressions diagnose themselves instead of hiding behind generic copy. Production still shows the polished "Something went wrong" card.

**Part 3 — GIF reactions render as standalone replies (not stacked under parent):**

Previously, GIF reactions used a separate `GifReactionBubble` component anchored to the *parent message's* side of the chat regardless of who sent the GIF — meaning the user's own GIF reactions appeared on the *other person's* side. Fixed by flattening GIF reactions into the main message stream so they render through `MessageBubble` with normal `isOwn` alignment plus a `QuotedReply` preview.

- `GET /api/messages/[conversationId]` — dropped the `.neq('type', 'gif_reaction')` filter from the messages SELECT; deleted the separate `gifReactionsResult` fetch and the `gifReactionsByParent` nesting; deleted the per-GIF-reaction emoji-attach loop. GIF reactions now flow through the same `reply_to` resolution as text replies (the existing `uniqueParentIds` block already covers any message with `parent_message_id`). The legacy `gif_reactions` field is intentionally omitted from the response payload. Also dropped `.neq('type', 'gif_reaction')` from the unread-count query — GIF reactions are real replies and should count toward the badge.
- `src/components/messages/MessageBubble.tsx` — new render case for `type === 'gif_reaction'` that renders the GIF media as a rounded image bubble; the existing `QuotedReply` block handles the parent reference. Deleted the `<GifReactionBubble>` block. Pruned unused props (`currentUserId`) and dead local state (`gifReactions = message.gif_reactions || []`).
- `src/components/messages/ChatWindow.tsx` — collapsed the realtime INSERT `if (gif_reaction) { … } return;` branch; flattened the optimistic-send in `handleGifReactSelect` to a plain prepend (with dedupe guard); simplified `updateMessageReactions`, `setMessageReactions`, the `reaction_update` broadcast handler, and `handleMessageEdited` to top-level searches only (no more nested gif_reactions lookups). Removed the `currentUserId={currentUserId}` prop from the `<MessageBubble>` call site.
- `src/components/messages/GifReactionBubble.tsx` — deleted. No remaining importers.
- Follow-up fix: `handleGifReactSelect` synthesizes `reply_to` client-side from the parent message in local state before prepending — matches the existing `handleSend` enrichment for text replies. Without this, the optimistic GIF reply rendered without the quoted preview (the POST endpoint returns the raw row only).

**Behaviour summary after the refactor:**
- Own text reply → right-side bubble + `QuotedReply` preview above (unchanged).
- Own GIF reply → right-side bubble + `QuotedReply` preview above (new).
- Their text/GIF reply → left-side bubble + `QuotedReply` preview above.
- Emoji reactions → still chips attached to the original bubble (unchanged).
- Realtime: incoming GIF replies arrive via the same fetch-full-and-prepend path as any other message — `reply_to` server-populated, no special handling.

**Verified:** `npm run lint` zero warnings. `npm run build` exit 0. New routes appear in route table: `/api/messages/reports`, PATCH on `/api/messages/[conversationId]/messages/[messageId]`. Net source delta: 5 new files, 7 modified, 1 deleted.

**Pending action (user):** apply `019_messaging_polish.sql` against Supabase. Until then, edit + report endpoints return 500 (defensive GET still works). Once applied, Phase 2 (per-message delivery + read receipts, online presence) is the next planned chunk per the messaging roadmap.

---

## May 23, 2026

### Production Maintenance Pass + Multi-Sport / Multi-Year Filter

Multi-iteration session covering four discrete pieces of work: foundation cleanup, mobile responsiveness, styling-system consolidation, performance code-splitting, and a new Sport + Year filter on Profile Media tabs. Build verified clean from a fresh `.next` cache at end of session.

**Part 1 — Foundation fixes:**
- `src/app/globals.css`: dropped dead `font-family: Arial` body override that was shadowing the next/font Inter applied via `layout.tsx`; removed unreferenced `--font-geist-*` vars; added `text-rendering`, font smoothing, and `-webkit-tap-highlight-color: transparent`
- `vercel.json`: removed no-op pass-through rewrite (`/(.*)` → `/$1`)
- Single `console.log` in `api/account/delete/route.ts` audited and kept (operational log for a destructive admin action)

**Part 2 — Mobile responsiveness:**
- `NotificationsDropdown.tsx` + `NotificationBell.tsx`: `w-96` was overflowing 375px-wide phones; switched to `w-[calc(100vw-1rem)] sm:w-96 max-w-[24rem]`
- `AppHeader.tsx`: added `safe-top safe-x` to the sticky header (the layout's `viewportFit: 'cover'` meant content was extending under the iOS notch); mobile drawer gained `safe-top safe-bottom`, widened to `w-72 max-w-[85vw]`, close-button hit area bumped to 44px via `p-2 -m-2`
- `globals.css`: new `.safe-top` / `.safe-bottom` / `.safe-x` / `.safe-y` utility classes for `env(safe-area-inset-*)` padding; mobile-only `input { font-size: 16px }` to prevent iOS auto-zoom on focus
- 23 modal dialogs left as-is — they already use `w-full max-w-X` patterns that adapt to phone widths; rewriting all of them to bottom-sheets was too risky for "don't break anything"

**Part 3 — Styling consolidation (modern, future-proof):**
- `globals.css` `@theme inline`: added semantic tokens — `--color-brand`, `--color-brand-hover`, `--color-brand-soft`, `--color-surface`, `--color-surface-muted`, `--color-border`, `--color-muted`, `--color-success`, `--color-danger`, `--color-warning`; radius scale (`--radius-sm` through `--radius-2xl`); z-index scale (`--z-sticky` through `--z-toast`)
- Global `:focus-visible` outline for keyboard-nav accessibility; `::selection` brand-color tint; `@media (prefers-reduced-motion: reduce)` block to disable animations for users with motion sensitivity
- Tokens are additive — no existing classes changed, so nothing visually drifted. Future code can use `text-brand` / `bg-surface-muted` etc.

**Part 4 — Performance code-split:**
- `next/dynamic` (with `ssr: false`) applied to heavy modals across `/feed`, `/athlete`, `/settings`, `/notifications` — `CreatePostModal` (2113 LOC), `EditProfileTabs` (1091 LOC), `EditPostModal`, `SeasonHighlightsModal`, `PerformanceModal`, `FollowersModal`
- First Load JS impact:
  - `/feed`: 225 kB → 195 kB (−30 kB / −13%)
  - `/athlete`: 257 kB → 249 kB (−8 kB)
  - `/settings`: 182 kB → 173 kB (−9 kB)
  - `/notifications`: 179 kB → 170 kB (−9 kB)

**Part 5 — Multi-Sport + Multi-Year filter on Profile Media tabs:**
- New migration `database/migrations/018_profile_media_sport_year_filters.sql` — drops + recreates `get_profile_all_media`, `get_profile_stats_media`, `get_profile_tagged_media` with two new optional array params (`filter_sport_keys TEXT[]`, `filter_years INT[]`). NULL = no filter. `get_profile_media_counts` intentionally untouched so tab badges stay stable when filters are active.
- New component `src/components/SportYearFilter.tsx` — controlled multi-select dropdowns with checkbox popovers, inline search (case-insensitive substring on label), `Escape` clears search then closes, outside-click closes, "Clear selection" per dropdown. Both dropdowns auto-focus search input on open.
- `src/app/api/profile/[profileId]/media/route.ts`:
  - GET handler parses `sportKeys` / `years` CSV query params and validates years against `1900 < n < 2200`
  - RPC payload is **conditional**: filter args only sent when non-empty so the call still resolves against the old 4-arg function signature when no filter is active (defensive degradation pre-migration)
  - Error log includes a migration-018 hint when filter args are present and the call fails
- `src/components/ProfileMediaTabs.tsx`:
  - State for `selectedSports` / `selectedYears` + URL param plumbing in `fetchMedia`
  - Dropdowns get static catalogs — `getAllSports()` from `sports-config.ts` sorted alphabetically, and years 2026 → 2000 generated at module load (auto-extends as years pass). The user wants the platform to feel multi-sport / multi-year regardless of the current athlete's post history.
  - Items count restyled from muted gray text to a brand-tinted pill (`bg-blue-50 text-blue-700 font-semibold` rounded-full)
  - New always-visible filter status row between filter row and items list — two states: "No filters applied" (muted, button disabled) when nothing selected; "N active filter(s)" + active "× Clear all filters" (blue, hover state) when filters present. Renders only on Media / Stats / Tagged tabs.

**Migration runbook:**
- `018_profile_media_sport_year_filters.sql` ran against Supabase mid-session. Verification: `SELECT proname, pronargs FROM pg_proc WHERE proname LIKE 'get_profile_%media'` returns `pronargs = 6` for all three.

**Memory hygiene:**
- 9 modified files + 2 new files this session; commit grouped into three logical commits (maintenance pass, filter feature, DEVLOG) per the "single git revert" preference.

**Verified:** `npm run lint` zero warnings; `npm run build` exit 0 from a fresh `.next` cache (63 static pages, middleware 70 kB, shared First Load JS 102 kB).

---

## May 5, 2026

### Codebase Audit — Low-Risk Polish

Full-app scan (routes, components, lib, API) to identify safe improvements. Audit found 8 issues; implemented 2 fixes that carry zero behavioral risk.

**Fix 1 — Remove debug text from followers page (`src/app/app/followers/page.tsx`):**
- Removed visible `Debug: {followers.length} fans in state` paragraph that rendered in the empty-state UI in production
- Replaced raw red error div (`Missing follower data for ID: ...`) with a silent `return null` — gracefully skips malformed entries instead of exposing internal state to users

**Fix 2 — Enable Next.js image optimization (`src/components/LazyImage.tsx`):**
- Removed `unoptimized={true}` that was forcing all images to bypass Next.js optimization
- `next.config` already declares `remotePatterns` for `**.supabase.co` and `**.supabase.in`, plus `formats: ['image/webp', 'image/avif']` and a 1-year cache TTL
- Net effect: all user/avatar/post images now get automatic WebP/AVIF conversion, responsive sizing, and CDN caching — zero code changes needed elsewhere

**Not changed (documented for future PRs):**
- ~380 console statements (needs selective per-file approach)
- Duplicate formatters across `formatters.ts`, `athleteService.ts`, `profile-display.ts`, `name-resolver.ts` (different signatures; needs dedicated consolidation PR)
- PostCard.tsx at 1030 lines (decomposition risks breaking state/refs)
- z-index inconsistencies across modals (needs all-modal stacking test)

**Verified:** `npm run build` exit 0, `npm run lint` zero warnings.

---

## May 4, 2026

### AbortController + P1 Silent-Catch Sweep

Two-part observability + stability pass.

**Part 1 — `AbortController` guard for MessagesProvider auto-fetches (`src/lib/messages.tsx`):**
After April 29's silent-catch fix, the post-login `TypeError: Failed to fetch` surfaced loudly in production. Inspection confirmed `/api/messages` was healthy — the error was an aborted fetch racing with the post-login redirect to `/athlete`. The fix adds an `AbortController` to the user-change effect so:
- `fetchConversations` and `refreshUnreadCount` accept an optional `AbortSignal` and pass it to `fetch`.
- The catch blocks treat `AbortError` as silent (intentional cancel) and keep logging every other failure loudly.
- The 30-second poll uses per-poll controllers so a stale abort never kills future polls.
- `Promise.all().finally()` only flips loading off if the controller wasn't aborted, preventing a stale effect's cleanup from stomping a fresh effect's loading state.

**Part 2 — P1 silent-catch sweep across user-facing pages and components:**
Replaced ~70 silent `} catch { /* ignore */ }` blocks across 42 files with `console.error('<context>:', e)` plus `else { console.error(...) }` for non-OK response branches that were previously swallowed. Same proven pattern from April 29's ChatWindow + MessagesProvider work. No happy-path changes; UI behavior identical except errors now surface to DevTools console + Vercel runtime logs for diagnosis.

**Pages updated (13 catches across 9 files):**
- `feed/page.tsx`, `app/followers/page.tsx`, `app/notifications/page.tsx`, `athlete/page.tsx`, `athlete/[id]/page.tsx`, `athlete/saved/page.tsx`, `u/[username]/page.tsx`, `app/sport/[sport_key]/activity/[id]/page.tsx`, `app/sport/golf/rounds/[roundId]/page.tsx`

**NotificationsProvider (`src/lib/notifications.tsx`, 6 catches):**
- Provider runs on every page for logged-in users. `refreshUnreadCount`, `fetchNotifications`, `markAsRead`, `markAllAsRead`, `deleteNotification`, `clearAll` now log specific context and preserve all existing optimistic-update rollback logic.

**Components updated (~50 catches across 31 files):**
- High-traffic: `CommentSection.tsx` (6), `FollowersModal.tsx` (4), `NotificationsDropdown.tsx` (3), `CreatePostModal.tsx` (3), `ProfileMediaTabs.tsx` (3), `SharePostModal.tsx` (2), `ConnectionSuggestions.tsx` (2), `TagPeopleModal.tsx` (2), `EquipmentSection.tsx` (2), `RecentPosts.tsx` (2), `ParticipantAttestationModal.tsx` (2)
- Single-catch: `PostCard.tsx`, `EditPostModal.tsx`, `EditProfileModal.tsx`, `FollowButton.tsx`, `VitalsTab.tsx`, `MultiSportHighlights.tsx`, `GolfScorecardForm.tsx`, `SearchBar.tsx`, `AdvancedSearchBar.tsx`, `GifPicker.tsx`, `HandleSelector.tsx`, `WaitlistPopup.tsx`, `PerformanceModal.tsx`, `MultiSportActivity.tsx`, `TaggedPosts.tsx`, `SeasonHighlightsModal.tsx`, `NewConversationModal.tsx`, `GroupSettingsModal.tsx`, `DeleteAccountModal.tsx`, `MessagingSettings.tsx`, `PrivacySettings.tsx`

**API route (`src/app/api/golf/participant-scores/route.ts`, 1 catch):**
- Outer try/catch was returning a 500 with no server-side log; now logs `console.error('POST /api/golf/participant-scores error:', e)` before returning the 500.

**Intentionally NOT modified (kept silent for documented reasons):**
- `lib/formatters.ts`, `lib/handle-validation.ts`, `lib/vitals-config.ts` — pure parsing/validation helpers where the catch is the documented "return false / return default" fallback path. Modifying these would change behavior, not just observability.
- `lib/golf-course-service.ts`, `lib/sports/adapters/GolfAdapter.ts`, `lib/email-service.ts` — service-layer fallback patterns.
- `lib/auth.tsx` (2 catches) — auth-refresh paths with intentional silent failover.
- `api/vitals/route.ts:24`, `api/posts/route.ts:400` — intentional optional-auth (`try { requireAuth } catch { currentUserId = null; }`) — control flow, not silent error swallowing.
- `api/search/route.ts` (3 catches) — intentional control flow that throws `'Fallback to ILIKE'` and catches to trigger fallback search; well-commented.
- `SharePostModal.tsx` `handleCopyLink` and `handleNativeShare` catches — fallback to manual copy / user-cancelled-share are expected paths, not failures.
- `followers/page.tsx:72` inner JSON-parse catch — intentional rethrow to convert parse-failure into a meaningful Error message.

**Commits in this pass:**
- `95b8461` — fix: AbortController guard for MessagesProvider auto-fetches
- `ae58286` — fix: P1 silent-catch sweep across pages, components, API
- `2b4ae3b` — docs: Add pasteable SQL runbook companion for migrations 014-017

**Verified:** `npm run build` exit 0 (63 static pages), `npm run lint` zero warnings.

**Net effect:** ~70 previously-invisible failures now surface to DevTools console + Vercel runtime logs with file/handler context. Zero behavioral changes on happy paths. UI feedback (toasts/error banners) unchanged where it already existed.

### Database migrations 014–017 — confirmed applied to Supabase

Tom ran the full `RUNBOOK_014-017.sql` against the production Supabase project and confirmed the at-a-glance status query returns `m014_applied | m015_applied | m016_applied | m017_applied = t | t | t | t`.

Latently-broken features now functional in production:
- **014** — notifications display real first/last names instead of falling back to handle-style `full_name`
- **015** — `posts.likes_count` / `posts.comments_count` stay in sync with row counts (one-time recount cleared any existing drift)
- **016** — comment pinning UI works end-to-end (post owner can pin one comment per post)
- **017** — emoji + GIF reactions in chat no longer 500 (the `message_reactions` row inserts and `parent_message_id` FK both now valid)

Recommended manual smoke tests in production:
- Send an emoji reaction to a chat message, then reload — reaction persists
- Send a GIF as a reaction — GIF nests under parent message and persists
- Pin a comment as the post owner — pinned comment renders at top with thumbtack icon
- Like a post, then unlike — count updates correctly without drift

---

## April 29, 2026

### Mobile-Readiness + Production-Stability Pass

Two-commit pass focused on getting Edge Athlete cleanly Vercel-deployable on mobile, removing silent failure modes, and adding a recoverable error UI for real-world conditions (flaky networks, content blockers, cache mismatches).

**Self-hosted Font Awesome (`src/app/layout.tsx`):**
- Replaced CDN `<link>` (`cdnjs.cloudflare.com/.../font-awesome`) with local `@fortawesome/fontawesome-free` package import
- Eliminates dependency on external CDN that can be blocked or fail on mobile networks; 456 icons now ship from app's own origin
- Added explicit `viewport` export (`width: device-width`, `initialScale: 1`, `maximumScale: 5`, `viewportFit: 'cover'`, `themeColor: #ffffff`) so iOS notched devices honor safe areas

**React Error Boundaries (`src/app/error.tsx`, `src/app/global-error.tsx`):**
- Added Next.js route-level + global error boundaries
- Failed renders now show a recoverable "Something went wrong / Try again / Go home" card instead of a white screen
- "Go home" uses `window.location.assign('/')` (full reload) to escape any broken router state
- Caught the cache-mismatch issue immediately in production after deploy — confirmed working as designed

**ChatWindow silent-catch sweep (`src/components/messages/ChatWindow.tsx`):**
- Replaced 7 silent `} catch { /* ignore */ }` blocks with `console.error` + non-OK response handling across `loadOlderMessages`, `handleDeleteMessage`, `handleToggleReaction`, `handleGifReactSelect`, `handleMuteToggle`, `handleLeave`, `handleBlock`
- Reaction toggle now snapshots prior reactions before optimistic mutation and reverts on failure or non-2xx response — UI no longer permanently desyncs from server when network fails
- Fixed React `exhaustive-deps` lint warning (added `setMessageReactions`, `updateMessageReactions` to callback deps)

**MessagesProvider silent-catch sweep (`src/lib/messages.tsx`):**
- Same fix pattern applied to `refreshUnreadCount`, `fetchConversations`, `markConversationRead`
- Provider runs on every page for logged-in users; previously these failures were invisible

**iOS Safari URL-bar fix (`src/app/messages/page.tsx`, `src/app/messages/[conversationId]/page.tsx`):**
- Added `h-[100dvh]` alongside `h-screen` on the two messages pages
- Modern browsers use dynamic viewport height (`dvh`) which tracks the actual visible area as Safari's URL bar shrinks/expands; older browsers ignore the unit and fall back to `h-screen`
- Fixes chat input being clipped under the URL bar on scroll

**Cosmetic mobile fixes:**
- `src/app/goodbye/page.tsx`: replaced `fa-wave-pulse` (Font Awesome Pro, not in free package) with `fa-circle-check`
- `src/app/athlete/page.tsx`: inline-edit popover `min-w-[300px]` → `min-w-[280px]` so it fits 320px-wide screens with margin

**Migration runbook (`database/migrations/RUNBOOK_014-017.md`):**
- New 430-line reference document for applying migrations 014–017 to Supabase
- Per-migration: goal, pre-check SQL, apply step, post-check SQL, optional smoke test
- At-a-glance status query at top to see which of the four are applied at any time
- Rollback notes per migration
- Most user-impacting: 017 (`message_reactions` schema needed for emoji/GIF reactions UI already shipped in production)

**Commits shipped (auto-deployed to Vercel):**
- `b957f94` — Self-host Font Awesome, add error boundaries, surface chat errors
- `e341203` — Mobile-readiness pass — viewport, dvh, messages provider

**Verified:** `npm run build` exit 0 (63 static pages), `npm run lint` zero warnings.

**Pending Tom's action (DB-side, not blockers for code):**
- Apply migrations 014–017 to Supabase using the new runbook
- Most urgent: 017 (without it, the already-shipped reactions feature 500s in production)

**Deferred for separate session (P1 silent-catch sweep):**
- ~25 more silent catches across `feed/`, `followers/`, `notifications/`, `athlete/saved/`, server-side API routes (`posts`, `vitals`, `search`)

---

## April 12, 2026

### Flat Chat Flow — Replace Threaded Replies with Linear Conversation

Replaced the Reddit-style threaded reply timeline (vertical lines, dots, nested ThreadItem components) with a compact single-line "replying to" reference bar. Replies now render as a natural flat chat stream instead of structured nested threads.

**QuotedReply rewrite (`src/components/messages/QuotedReply.tsx`):**
- Replaced ~280-line timeline renderer with ~75-line compact reference bar
- Removed ThreadItem, SharedPostCompact, SharedProfileCompact sub-components
- Single clickable row: `border-l-2` accent + optional thumbnail + "SenderName: snippet"
- Type-aware snippets: text (60 chars), Photo, Video, GIF, post captions, profile names
- Own messages: `bg-blue-700/30 border-blue-300`; others: `bg-gray-100 border-gray-400`
- Click still scrolls to and highlights the original message

**Ancestor chain removal (full stack):**
- `MessageBubble.tsx`: Removed `replyChain`/`currentUserId` props from QuotedReply call
- `ChatWindow.tsx`: Removed `ancestorChain` construction in `handleSend`
- `route.ts` (messages API): Removed ancestor walk loop (0-4 sequential DB queries per page load), `parent_message_id` from parent query/map, `reply_chain` from response
- `types/messages.ts`: Removed `reply_chain` field from `Message` interface

**What stays:** `reply_to` (immediate parent reference), `parent_message_id` (reply targeting), all reaction systems (emoji, GIF), reply button + reply mode, scroll-to-message, rich shared_post/shared_profile data on `reply_to`.

---

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
