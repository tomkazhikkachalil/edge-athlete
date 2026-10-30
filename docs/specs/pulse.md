# The pulse — the header's numbers in one call (Convention 54)

**Convention 54.** **Program:** the cost program (Oct 29 2026, `docs/COST.md`). **Status:** PR B shipped (migration 292); PR C (the change signals) next.

## The problem it solves

Every signed-in visible tab needed two numbers on every page — is anything live (the header's Live dot, `useLiveNow`, mounted by the header AND the tab bar) and how many messages are unread (the bell, `MessagesProvider` in the root layout). They were three polls: `/api/golf/live-now/count` + `/api/sport-events/live-now?count=1` once a minute and `/api/messages/unread-count` every two minutes. Three Vercel function calls a minute per tab, each with two to four Supabase trips, for every user, all day — the single largest sustained cost in the app, and the line that would make 10k users cost hundreds a month for nothing a user sees.

## The rules

1. **One endpoint.** `GET /api/me/pulse` → `{ liveNow: { golf, events, total }, unread: { messages } }`, `private, no-store`, `requireAuth`. One RPC, `me_pulse(viewer)` (migration 292), the SQL mirror of the routes' pure rules: golf = `countLiveVisibleRounds` / `isRoundLive` (`type='golf_round'`, status pending | active, the round's DATE within ±48 h of now read as UTC midnight, public OR the viewer on the roster with any status but `declined`); events = `readLiveEvents` / `liveEventCards` (`status='live'`, public OR the viewer's accepted row, AND a round with `status='live'`); messages = `get_unread_message_count` as it is. The three old routes stay (the strip's list, the parity spec, the load scripts). A deploy ahead of the migration answers 503 `Pulse updating`.
2. **One store.** `src/lib/pulse/pulse-store.ts` is a module-level store (the shape `useLiveNow` had): one coalesced fetch, one timer per tab, one resume catch-up, subscribers opt in — never a context provider (that would mount a fetch for signed-out visitors on public pages). It is the ONLY place that fetches `/api/me/pulse`. `useLiveNow(enabled)` and `MessagesProvider` subscribe; the header's count and the bell's total are the same fetch.
3. **When it fetches** (`pulse-rules.ts`, pure): never hidden or offline (the return catches up); a mount or a return reuses an answer younger than 30 s; the timer (60 s until PR C's signals move it to 10 min), a signal (debounced 1.5 s + up to 3 s jitter so a platform-wide tick spreads) and a demand always fetch. A failed fetch keeps the last numbers — the numbers are a nicety, never an error state.
4. **Local corrections, no fetch.** A conversation read here subtracts its unread from the store (`adjustPulseUnread`), never below zero; logout resets the store. The provider's optimistic decrement and the store agree.
5. **The list is not the count.** The conversation LIST keeps its two-minute page-one refresh and the `new_message` bell as its signal (scale fix 3); only the COUNT moved to the pulse.

## Pinned by

`src/lib/__tests__/pulse-rules.test.ts` (every rule), `src/lib/__tests__/me-pulse.test.ts` (292's predicates and grants, the one fetcher, the header and provider no longer poll the old routes, the route's headers and 503), `e2e/pulse.spec.ts` (parity with the three routes; A's private round with B on the roster counts for both and not for a stranger; a message raises A's unread by one and the read lowers it; signed out → 401).

## Next (PR C)

Realtime BROADCAST from DB triggers (`realtime.send`): a public `live-now` topic on golf-round and sport-event status changes, a private `user:{id}` topic on a message insert and a read; the client fetches the pulse on a signal and the timer becomes a 10-minute safety net.
