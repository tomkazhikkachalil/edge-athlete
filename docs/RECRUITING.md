# Recruiting — the skeleton (Sep 10 2026, R1–R5)

The recruiting dataset is the platform's long game (masterplan §7: the
provenance ladder "is the integrity story a scout or a college coach will
actually interrogate"). This is its first skeleton: the entities, the gates,
one scout-facing surface. Everything here is deliberately small and named
so the next programs (named lists, school as an entity, a scout capability
on other account types, an audit trail, as-of sanctioning) are additions,
not rewrites.

## Entities

| Thing | Where | Rule |
| --- | --- | --- |
| Recruiting status | `profiles.recruiting_status` (182): `closed \| open \| committed`, default closed | THE one gate. Closed ⇒ nothing recruiting-facing renders and the academics are never selected. |
| Recruiting profile | `profiles.recruiting_profile` jsonb (182): `{ gpa, academic_notes, target_level }` | Parsed by `src/lib/recruiting/schema.ts`; unknown keys dropped; GPA always renders "self-reported". |
| School / grad year | `profiles.school` (editable since R1), `profiles.class_year` (IS the grad year — nothing renamed) | `school` is an identity field (guardians hear about changes). |
| Scout account | `profiles.user_type = 'scout'` (182), `scout_affiliation` | Minted only by the signup actor branch (`signup-user-type.ts`) — never a client-sent `user_type`. No handle, no DOB (adult assumed, the organizer precedent). |
| Shortlist | `scout_shortlists` (183): PK (scout, athlete), note ≤500 | Posture A; `requireScout` on every route; the athlete sees a COUNT, never names. |

## Gates (each in exactly one place)

- `isRecruitable(p)` — `src/lib/recruiting/profile.ts`: claimed (not a stub)
  AND public AND status ≠ closed. **Supervision is not a term** (Tom, Sep
  10): the only way a supervised profile's status changes is a guardian
  through `manage_settings`, so a guardian-opened supervised athlete is
  recruitable. The shortlist POST and the scout search re-apply it.
- `GET /api/profile/[id]/recruiting` — owner + guardians read everything
  (`canEdit`); anyone else reads the card only when open/committed AND
  `canViewProfile` admits them; closed answers `{ status: 'closed' }` only.
- `PATCH /api/profile/[id]/recruiting` — `manage_settings` (self as owner, or
  a guardian; never the supervised profile itself); the batched profile PUT
  strips the recruiting fields.
- `requireScout` — `src/lib/recruiting/scout-access.ts`: a session whose
  profile is a claimed, unsupervised `'scout'`; registered in the
  route-authz test's gate list.
- Contact is the profile's existing message flow — its permission tiers and
  the first-contact hold. There is no recruiting email, on purpose.

## Surfaces

- `RecruitingCard` on `/u/[username]`, `/athlete/[id]`, `/athlete` (route
  parity) — reads its own endpoint, never the CDN payload; a scout viewer of
  an open card gets the Shortlist toggle; the owner/guardian sees the count.
- The edit modal's Recruiting tab (hidden for a supervised athlete editing
  themselves); the guardian console's Recruiting section.
- `/app/scout` (the shortlist, note editor, removal), `/app/scout/search`
  ("Find athletes": name, sport, grad-year window — a bounded `profiles`
  query, NOT the search index; `docs/SEARCH.md` says why).
- `/help/verified-stats` — the ladder explained; the Official log links it
  and shows "Unconfirmed" on a disputed line (left out of the headline
  numbers until resolved).

## Growth paths (not built)

Named lists (`list_id` on the shortlist); school as an entity (a `places`-like
table behind `profiles.school`); a `scout_status` capability on other adult
account types, or school orgs with scouts as staff (the org staff ladder);
`recruiting_events` (view / shortlist / contact, append-only, retention) —
"who viewed me" reopens the names-vs-counts question; as-of-date sanctioning
from `sanction_grants`; ranked recruiting search on the index when the
recruitable population outgrows a bounded query; masked rendering of
supervised athletes on scout surfaces if that policy ever changes.
