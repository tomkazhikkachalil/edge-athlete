# Support and reporting

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 23 — Support is ONE ticket table behind three doors; type is a field (Support & Reporting program, Spec 1, Sep 20 2026, #836–#841, mig 222 the ONLY DDL)

**Support is ONE ticket table behind three doors; type is a field
(Support & Reporting program, Spec 1, Sep 20 2026, #836–#841, mig 222
the ONLY DDL)** — Tom's Game Plan: help requests, reports and
suggestions are rows of `tickets` (`number` a bigint IDENTITY from 1000,
rendered `EA-1000` — the chain's first identity column; the uuid stays the
URL id because numbers are guessable); `ticket_events` is APPEND-ONLY (one
row per statement — a batch would share `created_at`); `platform_admins`
holds `owner | moderator` (the env allowlist keeps meaning OWNER;
`requireModerator(request, { intent })` admits a moderator to `work_queue`
only; `delete_ticket` / `manage_roles` are owner-only; `/api/admin/me`
answers `{ admin, role }` and `admin` still means owner). Posture A on all
three — the projection IS the access rule: `src/lib/tickets/visibility.ts`'s
USER projection never carries the assignee, the reported user, the
snapshot or the email (pinned), and a stranger's ticket is a 404, never a
403. `src/lib/tickets/server.ts` is the ONE writer. Severity is set at
submit (`severity.ts`: report critical on minor_safety / self_harm / a
supervised target, high on harassment · hate · sexual · impersonation;
help medium; suggestion low) and the response targets are GUIDANCE
(overdue marker; nothing escalates). Transitions are pure
(`transitions.ts`): a user reply answers waiting_on_user, appeals resolved
ONCE (`appeal_used_at`), never touches closed; a reopen clears the
resolution code (the CHECK). **Strikes are DERIVED** — a closed report
ticket resolved warning · suspension · ban against `target_profile_id` —
never a table. A supervised submitter's ticket mails the guardians
(`mail.ts`, the digest's query) and the guardian sees it under My
requests; a Critical ticket bells every owner / moderator
(`ticket_critical`, in `URGENT_TYPES` — the ten-minute email is the
"notified now" channel; no SMS exists). Two years after close the daily
cron ANONYMIZES (never deletes). `docs/SUPPORT.md` is the reference; read
DEVLOG Sep 20 2026 Spec 1 PR 1–5 first. **Spec 2 (Reporting, #843–#847,
mig 223):** a report is filed FROM the thing through ONE sheet
(`ReportSheet`, opened from the house `ActionMenu` on every non-owner post,
non-own comment, both profile routes and the DM thread menu; Block + Mute
offered after; 9-8-8 on self-harm); the snapshot is server-side and
access-checked (`snapshot-server.ts` — a target the reporter cannot see is
a 404); duplicates MERGE (`merged_into_id`, the reporter keeps their entry;
3+ on High hides). **Tom's rule: a Critical report acts on the
INTERACTION** (a post / comment → `status = 'hidden'`, a STATUS so every
published-only reader hides it; a DM thread → `conversations.frozen_at`),
**and the account is limited only on repeat incidents** (2+ other reports
in 90 days — ANY severity) or by an admin. `profiles.moderation_state`
(`active · limited · suspended · banned`) is enforced by `requireActiveWriter`
on THE list of 23 content + contact routes (24 until the `.FIT` import route left, Oct 13 2026; pinned by
`src/lib/__tests__/write-gate.test.ts` — never a blanket; the ticket
routes stay open) and, for suspended / banned, by Supabase Auth's
`ban_duration` (a suspended session answers 401 at `getUser`). The
resolution code IS the action (`moderation/state.ts actionForResolution`);
the reported user gets a `moderation_notice` and a RESTRICTED view
(`projectTicketForSubject` — never the reporter, the description or the
snapshot) for the one appeal; a report closed with no action is never
announced. Mutes (`user_mutes`) and blocks both filter the feed, the
comments and the bell through `mutes.ts hiddenAuthorsFor`. **Spec 3 (the
Help Center, #848–#852, mig 224):** `/help` is PUBLIC — `help_articles` is
ONE table for articles and how-to videos (a video = a YouTube `video_url`,
validated through the site builder's `parseEmbedUrl`; the body is PLAIN
TEXT rendered as blocks, never HTML); the public read is CDN-cached 60 s
(Vercel consumes `s-maxage` — a spec settles it first); the owner edits at
`/dashboard/help`; a signed-out visitor files through `POST /api/tickets/
guest` (honeypot + the `contact` IP bucket; `guest_email` is the
recipient); `/contact` files a Help ticket; a screenshot rides `POST
/api/tickets/attachment` under the user's `tickets/` prefix (re-asserted on
create, registered in `URL_SOURCE_COLUMNS`, served through the proxy's
`ticket` entity; NOT behind the write gate). e2e: the project's
`storageState` signs EVERY context in — a signed-out actor is an explicit
empty `storageState`. **Spec 4 (suggestions + polish, #853–#854, zero DDL):**
Suggest a feature on `/help` files a `suggestion` at LOW (`contact_ok`
governs follow-up mail only); an admin MERGES duplicates by number
(`POST /api/admin/tickets/[id]/merge` — the duplicate closes as "Merged
into", keeps its reporter's entry, the target carries `report_count`);
`feature_shipped` bells + mails the merged duplicates' reporters too; the
pasted reply (`POST …/paste-reply`) is how an emailed reply reaches the
ticket (no inbound parsing, by decision). **The program is COMPLETE**
(Sep 20 2026); `docs/SUPPORT.md` is the reference for every spec.
