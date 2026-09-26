# Support & Reporting — the ticket backend

The reference for the in-app support system: one company-owned ticket table
behind three front doors (Help Center, Report, Suggest). Tom's design doc
("Edge Athlete Support and Reporting Game Plan", Sep 17 2026) is the source;
this file records what was built and the rules a change must keep. Program
state: **THE PROGRAM IS COMPLETE + PROD-PROVEN (Sep 20 2026; Spec 1 #836–#842,
migration 222; Spec 2 #843–#847, migration 223; Spec 3 #848–#852, migration
224; Spec 4 #853–#854, zero DDL)** — the backend, the admin console, the
user's front door, reporting from the content with enforcement, the Help
Center, and suggestions; every spec green on prod on both mobile engines.
What stays Tom's: the five videos, the contact details, the crisis line, and
the Resend DNS records that turn every ticket email from guarded to sent.

## The one rule

**Type is a field, not a separate system.** Help requests, reports and
suggestions are rows of `tickets`. Everything that works a ticket — the queue,
the history, the emails, retention — is written once and applies to all three.

## Entities (migration 222)

| Thing | Where | Rule |
| --- | --- | --- |
| Ticket | `tickets` | One row per help request / report / suggestion. `type ∈ help · report · suggestion`; `subtype` only on a report (`post · comment · profile · dm · incident`); `reason` is the report reason / help category / suggestion area — one column, validated per type in the app. |
| Ticket number | `tickets.number` (bigint IDENTITY from 1000) | Rendered `EA-1000` by `src/lib/tickets/number.ts`. The uuid stays the primary key and the URL id — numbers are guessable. The first identity column in the chain. |
| Severity | `tickets.severity` | Set automatically at submit from type + reason (+ whether the target is a minor) by `src/lib/tickets/severity.ts`; an admin may change it. Drives queue order and the response target. |
| Status | `tickets.status` | `new → in_review → waiting_on_user → resolved → closed`. Transitions are pinned in `src/lib/tickets/transitions.ts`. |
| History | `ticket_events` | APPEND-ONLY. Every status / severity / assignee change, note, reply, merge, action, email and the anonymize stamp. `visible_to_user` decides what "My requests" shows; internal notes never leave the console. |
| The reported thing | `target_type` + `target_id` (no FK) + `content_snapshot` | The content may be edited or deleted after the report; the snapshot is the record. `target_profile_id` is the reported user (prior tickets, strikes, dedup). |
| Admin roles | `platform_admins` | `owner · moderator`. The env allowlist (`OWNER_EMAILS` + `ADMIN_EMAILS`) keeps meaning OWNER; a moderator row admits the support queue only. Only an owner writes this table — enforced in the API. |
| Bells | `ticket_update` · `ticket_critical` | The submitter's bell on a visible change; every owner / moderator's bell on a Critical ticket (also mailed by the urgent-email sweep within ten minutes). |

## Decisions (Tom, Sep 17–20 2026)

- **Auto-hide + limit on Critical**: the reported item is hidden and the
  reported account goes read-only until an admin acts (Spec 2).
- **No inbound email parsing in v1**: replies to `support@` are pasted onto the
  ticket from the console; the in-app reply under My requests is the primary
  path.
- **Strike ladder as written**: first confirmed violation = warning, second =
  7-day suspension, third = ban; Critical skips to suspension or ban.
  **Strikes are DERIVED** — a closed report ticket resolved `warning ·
  suspension · ban` against `target_profile_id` — never a second table.
- **Response targets are guidance**: Critical 1 h · High same business day ·
  Medium 2 business days · Low weekly (`SLA_HOURS`); the queue marks overdue;
  nothing escalates automatically; the created email quotes the target.
- **A minor's ticket goes to the parent**: `reporter_email` is NULL for a
  supervised reporter (the synthetic address never renders); the mailer
  resolves the guardians' emails at send time (the digest's query); the
  guardian sees the ticket under My requests through `profile_access`.
- **Reports are anonymous to the reported user.** The reported user is told
  what happened and why, never who reported them, and may appeal once
  (`appeal_used_at`).
- **Retention**: two years after close the daily cron ANONYMIZES a ticket
  (reporter, email, description, snapshot and event bodies nulled; number,
  type, reason, severity, resolution and timestamps kept for audit).
- **Critical notification "now"** is the fastest channel that exists: the
  bell + the ten-minute urgent email. There is no SMS or push in the codebase;
  `src/lib/notify/dispatch-core.ts` is built for an SMS adapter if wanted.

## Gates

- User routes (`/api/tickets/*`): `requireAuth`; a supervised profile may file;
  a guardian reads their supervised athletes' tickets.
- Admin routes (`/api/admin/tickets/*`): `requireModerator(request, { intent })`
  — `work_queue` admits owner and moderator; `delete_ticket` and
  `manage_roles` are owner-only.
- Posture A on all three tables: the service role is the only reader and
  writer; every read is projected (`src/lib/tickets/visibility.ts`) — the
  user projection never carries the assignee, internal notes, the target's
  profile id or a report's snapshot.

## Surfaces (Spec 1)

| Surface | Where | What |
| --- | --- | --- |
| The queue | `/dashboard/tickets` (owner or moderator) | Open tickets critical-first then oldest; open / overdue / critical / reports counts; status pills, type + severity selects, search by `EA-####` or subject; an Overdue badge; one column at every width. |
| The ticket | `/dashboard/tickets/[id]` | Severity, assignee (the roles table + allowlisted owners), the suggestion tag; Take into review · Resolve… (a code + the plain-words note the user reads, behind `ConfirmModal`) · Close · Reopen; the request + the content snapshot; the reporter / reported-user cards (masked names, account age, filed / against, the DERIVED strike count); reply (bell + email) and internal note; the history with notes marked. |
| The door | The dashboard's Support queue tile; the header's "Support queue" (owner or moderator; "Admin dashboard" stays owner-only). | |
| The front door | `/settings?tab=support` | Submit a request (a Help ticket → the number + the response target); My requests (own + supervised athletes'), a row expanding INLINE to the thread and the reply box (appeal wording on resolved); `?ticket=<id>` — the bells' link — expands that row. Spec 3 grows this into `/help`. |

## Files

- `database/migrations/222_tickets.sql` (+ `database/tests/diagnostics/verify-222-tickets.sql`)
- `src/lib/tickets/` — types · number · severity · transitions · events · visibility (pure, pinned) · server (the ONE writer) · mail (the recipients)
- `src/app/api/tickets/{route,[id]/route,[id]/reply/route}.ts`; `src/app/api/admin/tickets/{route,stats/route,[id]/route,[id]/notes/route,[id]/reply/route}.ts`; `src/app/api/admin/roles/route.ts`; `/api/admin/me` answers `{ admin, role }`
- `src/app/(app)/dashboard/tickets/{page,[id]/page}.tsx`; `src/components/admin/SupportQueueTile.tsx`; `src/components/tickets/ticket-ui.tsx` (chips, `ago`, event wording); `src/components/settings/SupportSettings.tsx`
- e2e: `tickets.spec.ts` (the API flow), `tickets-admin-ui.spec.ts`, `tickets-user-ui.spec.ts` — all `@mobile`; bravo becomes a moderator through the service key so the queue is CI-testable without `E2E_ADMIN_EMAIL`

## Traps

- The Playwright project's `use.storageState` signs EVERY context in — `browser.newContext()` and the `request` fixture. A signed-out actor is an explicit empty `storageState: { cookies: [], origins: [] }`.
- A PostgREST batch insert sends `null` for a key one row omits (a NOT NULL with a DEFAULT still fails) — spell out every column.
- Vercel consumes `s-maxage` (answers `public`); a spec that reads a CDN-cached route settles it first.
- The repeat-incident rule counts EVERY report, not only Critical ones (a probe found it inside the Critical branch); a merged duplicate stays in its reporter's My requests (the queue hides it, nothing else).
- A suspended session answers 401 (the auth ban at `getUser`) before the app gate's 403 — either is a refusal.
- A `useState` after an early return crashes the page ("Rendered more hooks") — hooks sit with the other hooks.
- A shell heredoc that creates a file is not verified until `ls` says so — `/api/tickets/route.ts` shipped missing (#838) because a zsh-globbed `[id]` broke the `&&` chain; a spec that self-skips pre-migration has NOT run (#839).
- History rows are appended one per statement: rows of one batch share `created_at`, and the history is read by it.
- A reopen must clear `resolution_code` — the CHECK allows a code only on resolved / closed.
- `LargerWindow` must hold no dirty input — the user's thread + reply box expand inline.
- `set-state-in-effect` shapes every loader: define it inside the effect, publish it on a ref (the consent page's shape).
- Departed accounts (238): a ticket FILED by someone who left keeps its history, but the engine clears its `reporter_email` at departure (no one to mail); a report AGAINST someone who left still resolves — the target is a tombstone row whose name renders in full. The mailers refuse `@departed.invalid` beside `@minors.invalid` / `@stubs.invalid`.

## Spec 2 — Reporting and enforcement (migration 223)

Tom's rules (Sep 20 2026): **a single report acts on the INTERACTION, not the
account** — a reported post / comment is hidden, a reported DM thread is
frozen (no one sends, everyone reads); **the account is limited only on repeat
incidents** (two or more other report tickets in 90 days at intake) or by an
admin; **the resolution code IS the action**; **the reported user gets a
restricted view** for the one appeal; **reports are anonymous** to the
reported user — a report closed with no action is never announced.

| Thing | Where | Rule |
| --- | --- | --- |
| Hidden content | `posts.status` / `post_comments.status` = `hidden` (+ `hidden_at`, `hidden_ticket_id`) | A STATUS: every published-only reader (the RLS policy, the feed, the comments read, the media RPCs, the 095 count + notify triggers) hides it with no new code; the author keeps their own view. Never deleted — evidence. `unhide` restores `published`. |
| Frozen thread | `conversations.frozen_at` (+ `frozen_ticket_id`) | The DM send route answers 403 `conversation_frozen`; reading stays open. Distinct from the first-contact hold (131). |
| The account | `profiles.moderation_state` (`active · limited · suspended · banned`) + `moderation_until` + `moderation_ticket_id` | `effectiveState` (an expired suspension reads as active; the daily cron lifts it). `suspended` / `banned` ALSO set Supabase Auth `ban_duration` (login refused); `lift` clears it. |
| The write gate | `requireActiveWriter(request)` / `activeWriterRefusal(userId)` in `auth-server.ts` | TARGETED: the list below, never a blanket. A refused write answers 403 `{ code: 'account_limited', state }`. Reads stay open; the ticket routes stay open (a limited user must still reach support). Pinned by `src/lib/__tests__/write-gate.test.ts`. |
| Mute | `user_mutes` (posture A); `/api/mutes` | Silent, one-directional: `hiddenAuthorsFor` (mutes ∪ blocks in both directions) filters the feed, the comments read and the bell. |
| The snapshot | `tickets.content_snapshot`, written by `snapshot-server.ts resolveTarget` | A projection of the existing reader's shape (never an email or supervision state; names through `publicDisplayName`; a DM thread keeps its `deleted_at` redaction; the last 20 messages). A target the reporter cannot see is a 404. |
| The merge | `merged_into_id` + `report_count` | A report on the same item with an OPEN ticket in 7 days creates its row merged into it (the reporter keeps their My requests entry); the open ticket's count bumps; three or more on a High item hide it. |
| Intake (Critical) | `moderation/server.ts applyIntake` | Post / comment → hidden; conversation / message → frozen; the account → `limited` only on repeat incidents. |
| Actions | `POST /api/admin/tickets/[id]/actions { hide · unhide · freeze · unfreeze · limit · lift }` | Before a decision; each stamps the ticket and appends `action_taken`. |
| Resolution | `applyResolutionAction` on `PATCH … status: resolved` | `no_action` / `declined` restore what intake did; `content_removed` hides; `warning` notices; `suspension` = 7 days + auth ban; `ban` permanent. The reported user's bell is `moderation_notice` (+ their guardians' copy + the email). |
| The appeal | `projectTicketForSubject` / `subjectVisibleEvents` | The reported user reads the number, the outcome and a thread of their replies + support's after the decision — never the reporter, the description or the snapshot. One appeal. |

### Surfaces (Spec 2)

| Surface | Where | What |
| --- | --- | --- |
| The "…" menu | `src/components/ActionMenu.tsx` | The house menu (portal, `placeMenu`, dismissal; rows as data). `PostOwnerMenu` keeps the owner's rows; every signed-in NON-owner gets one on a post card; a non-own comment; both profile routes (`/athlete/[id]`, `/u/[username]`); "Report conversation" in the DM thread menu. |
| The report sheet | `src/components/tickets/ReportSheet.tsx` | ONE sheet: the doc's reasons with hints, optional details, submit → the number → **Block** + **Mute** (immediate); the 9-8-8 crisis resources on `self_harm` (`COPY.SUPPORT`). Dirty text guarded on close. |
| The banner | `src/components/ModerationBanner.tsx` (root layout) | Limited / suspended (until …) / banned, "See why" → the notice. The author of a hidden post sees a badge on their own card. |
| The admin ticket | `/dashboard/tickets/[id]` | `SnapshotView` per kind (post with proxied thumbnails, comment, profile, DM thread with redaction + the focused message); the "Right now" strip (Hide / Unhide · Freeze / Unfreeze · Limit / Lift over the live `enforcement` state); the ladder hint. |
| About your account | `/settings?tab=support` | The decisions made about this account — the restricted view + the one appeal. |
| Legacy | `/api/admin/reports`, `message_reports` | Read-only history of the 019 rows (owner-only). The writer files tickets; the dashboard panel is gone. |

**THE list — the write routes the gate covers** (`src/app/api/…`):
`posts/route.ts` (POST, PUT) · `comments/route.ts` (POST) · `messages/route.ts` (POST) ·
`messages/[conversationId]/messages/route.ts` (POST) · `group-posts/route.ts` (POST) ·
`follow/route.ts` (POST) · `tags/route.ts` (POST) · `upload/route.ts` · `upload/post-media/route.ts` ·
`upload/avatar/route.ts` · `upload/cover/route.ts` · `upload/equipment/route.ts` (POST) ·
`profile/route.ts` (PUT) · `sport-events/route.ts` (POST) · `sport-events/[id]/participants/join/route.ts` (POST) ·
`clubs/requests/route.ts` (POST) · `leagues/requests/route.ts` (POST).
Adding a route is a deliberate decision: extend the test's list and this one together.

## Spec 3 — the Help Center (migration 224)

The doc's four parts, top to bottom, at `/help` — PUBLIC (a signed-out visitor
reads everything and files through the guest form). Settings → Support keeps
hosting the same request + My requests components (the bells' deep link lands
there).

| Thing | Where | Rule |
| --- | --- | --- |
| Articles + videos | `help_articles` (224; posture A) | ONE table: a video is an article with a `video_url`. Topic from the fixed list (`src/lib/help/types.ts HELP_TOPICS`, pinned against the CHECK); `slug` derived from the title (`slugify`) unless given; `published` gates the public read; the body is PLAIN TEXT rendered as blocks (`src/lib/help/body.ts` — blank line = paragraph, `- ` = bullet, `## ` = heading, bare URLs link; never HTML). |
| The public read | `GET /api/help/articles` + `/[slug]` | Viewer-independent, CDN-cached `s-maxage=60` (Vercel consumes the directive and answers `cache-control: public`; an edit shows within a minute); drafts 404. A spec that reads it SETTLES it first (`e2e/helpers/isr.ts`). |
| The owner's editor | `/dashboard/help` → `/api/admin/help/articles` (owner-only) | List with Draft / Published; one form; a video link must parse as YouTube through the site builder's `parseEmbedUrl` — never an arbitrary iframe source. |
| Click-to-play | `src/components/help/HelpVideo.tsx` | The YouTube thumbnail first; the `youtube-nocookie.com` player (in the CSP's `frame-src`) mounts only on tap. |
| The guest request | `POST /api/tickets/guest` | No session; email required; a honeypot (`website`) answers `EA-0000` and stores nothing; the `contact` IP bucket; Help only. `createTicket` takes a null submitter + `guestEmail` (the mails go there). |
| `/contact` | `POST /api/contact` | An adapter: a Help ticket (`other`, the visitor's name in the subject) — by the session or as a guest. The 096 `contact_messages` table stops growing. |
| The screenshot | `POST /api/tickets/attachment` → `tickets.attachment_url` | An image ≤ 5 MB under `uploads/{userId}/tickets/`; `POST /api/tickets` re-asserts the prefix; the column is registered in `URL_SOURCE_COLUMNS` (the sweep rule); served through the media proxy's `ticket` entity (the submitter, their guardians) or the moderator override (now the platform ROLE, not only the allowlisted owner). NOT behind the write gate: a limited account must still show support what it sees. |
| Contact | `COPY.SUPPORT.CONTACT_*` | Tom's name + support@edgeathlete.ca; no phone until told. |
| The doors | Profile dropdown + drawer "Help Center"; footer "Help"; `/contact` points at it. | |

## Spec 4 — suggestions and the polish (zero DDL)

| Thing | Where | Rule |
| --- | --- | --- |
| Suggest a feature | `src/components/help/SuggestForm.tsx` on `/help` (signed in) | Area from the fixed list, a one-line title, a description, "OK to contact me" → a `suggestion` ticket at LOW (the weekly review). `contact_ok` governs FOLLOW-UP mail only (`sendTicketMail` skips the waiting / resolved mails for a suggestion with it off) — never ticket status mail. |
| The weekly review | `suggestion_tag` (planned · maybe · declined) — a select on the admin ticket | Guidance, not a workflow. |
| Merge duplicates | `POST /api/admin/tickets/[id]/merge { into: 'EA-1042' }` (`mergeTicket`) + the box on the ticket | Same type only; the duplicate CLOSES as "Merged into EA-…" and keeps its reporter's My requests entry; the target carries `report_count`; the queue lists one; a self-merge or a merge into a merged row is a 409. (Spec 2's report merge at INTAKE is the automatic twin.) |
| Feature shipped | `PATCH … status: resolved, resolution_code: feature_shipped` | The reporter's bell + mail ("your idea is live") AND the merged duplicates' reporters' — their rows are marked shipped too. |
| The pasted reply | `POST /api/admin/tickets/[id]/paste-reply` (`pasteUserReply`) + the box on the ticket | Decided: no inbound parsing in v1. The emailed text lands as the USER's reply (actor null, `old_value 'pasted'`) with the same status effect as an in-app reply; an internal note names who pasted. |
| The stats | `/dashboard/tickets` (from `GET /api/admin/tickets/stats`) | Resolved in 90 days, the median hours to resolve, open by type. |

## Authority — reports of an org or event, the recovery request, the recovery panels (migration 240, Sep 25 2026)

Tom: "Even if there isn't a contact, we need a way to recover and for users to manage the site if something were to happen or if someone is being malicious." The Edge Athlete team decides, on a ticket, and every act is recorded.

| What | Where | The rule |
| --- | --- | --- |
| Report a club, league, its site or an event | The org page's **Report** (signed-in visitors who do not run it), the event page's **Report this event**, `?report=1` on both, and the public site footer's **Report this site** (an absolute, static link — it works on a custom domain) | `target_type` / `subtype` `org` · `sport_event` (240). The snapshot records the org's name, description, visibility and the site's `published_revision_id` (the "restore to before" pointer). **`profileId` is null**: the thing is reported, never a person — no strike, and never an intake action (`NO_INTAKE_TARGETS`). Your own org or event is a 404 here; its owners use the recovery request. The one-click actions answer "Use the recovery panel". |
| The recovery request | `/help#recover` (`RecoverForm`), signed in (`POST /api/tickets`) or OUT (`POST /api/tickets/guest`) | A Help ticket, reason `recovery`, severity **high**. The link, domain or name rides as `reference`; `recoveryTicketFields` puts it at the top of the description and sets the target only on ONE match. The answer is the same 201 whatever it finds, so the form never discloses whether something exists. The page states the process: the team verifies, a request alone never hands anything over, everything is recorded. |
| The recovery panels | `/dashboard/recovery` (search), `/dashboard/recovery/org/[id]`, `/dashboard/recovery/event/[id]`; "Open recovery tools" on every open ticket (straight to the panel when the ticket targets an org or event) | **Owner-only** (`requireModerator(…, { intent: 'recover_authority' })`, deliberately not in `MODERATOR_INTENTS`). Every act names an OPEN ticket and a reason, takes the `authority-admin` bucket, writes a PLATFORM row to `authority_audit` on that ticket, an internal `action_taken` on the ticket, and an `authority_notice` bell that says "Edge Athlete support" (never the admin). Org: add an owner (id, @handle or email), remove one (they become a member; the last only with a replacement in the same act), manager → member, revoke staff, a **recovery link**, pause / release the site, delist, restore a published version (no prune), undo an identity change, restore deleted news. Event: re-host (an outsider joins as a non-playing co-organizer first; the old host stays a participant), remove a co-organizer, cancel (before it starts), make private (a live event is never cancelled). Resolve the ticket with **Access restored** (`access_restored`). |
| The recovery link | minted in the org panel | `org_claim_invites.purpose = 'recovery'`: single use, 7 days, bound to ONE email and the ticket; it ADDS an owner (removes no one) even when the org has owners. The redeemer must be signed in with that email, and not deleted, supervised or moderated. Deleting the ticket deletes its links first (240's CHECK would refuse the SET NULL). |
| The site hold | the panel's Pause | `org_sites.held_at` + `held_ticket_id`, offline in the same write; 240's CHECK refuses held-and-live from any path. While held: going live and publishing answer 409 `held: true`, the token preview is a 404. Release leaves it offline for the owners to take live. |

## Parked (the doc's own list, still open)

- Inbound email parsing (Resend inbound + the `EA-####` subject) — when the paste box becomes a chore.
- An SMS adapter for "Tom notified now" (`src/lib/notify/dispatch-core.ts` is ready for one) — if ten minutes is too slow.
- The five videos, the contact details, the crisis line — Tom's content.

- **Spec 2 — Reporting**: Report from the three-dot menu on posts, comments,
  profiles and DM threads; the one reason list; the content snapshot; Block
  and Mute offered after a report; auto-severity with the minor rule; the
  7-day merge (`report_count`); auto-hide + read-only on Critical
  (`profiles.moderation_state`, `posts.hidden_at` — mig 223); the one-click
  actions and the ladder from derived strikes; the self-harm resources message.
